const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { BskyAgent } = require('@atproto/api');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

let runningAccounts = [];
let donationLink = "";

/* تحميل المنشورات من ملف Excel */
function loadPostsFromExcel() {
  const workbook = XLSX.readFile('posts.xlsx');
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  let posts = XLSX.utils.sheet_to_json(sheet, { header: 1 })
    .flat()
    .filter(text => typeof text === 'string' && text.trim() !== '');
  return [...new Set(posts)];
}

/* تأخير */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* إنشاء Facet للرابط */
function generateFacet(text, url) {
  const encoder = new TextEncoder();
  const byteStart = encoder.encode(text.substring(0, text.indexOf(url))).length;
  const byteEnd = byteStart + encoder.encode(url).length;

  return [{
    index: { byteStart, byteEnd },
    features: [{
      $type: 'app.bsky.richtext.facet#link',
      uri: url
    }]
  }];
}

/* اختيار mentions عشوائيًا من mentions.txt */
function getNextMentions() {
  const allMentions = fs.readFileSync('mentions.txt', 'utf-8')
    .split('\n')
    .filter(m => m.trim() !== '');
  const selected = allMentions.sort(() => 0.5 - Math.random()).slice(0, 1);
  return selected.map(m => `@${m}`).join(' ');
}

/* إنشاء Facets للمنشن */
async function createMentionFacets(text, agent) {
  const mentions = [];
  const regex = /@([\w.-]+\.bsky\.social)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const handle = match[1];
    try {
      const profile = await agent.getProfile({ actor: handle });
      if (profile?.data?.did) {
        const encoder = new TextEncoder();
        mentions.push({
          index: {
            byteStart: encoder.encode(text.substring(0, match.index)).length,
            byteEnd: encoder.encode(text.substring(0, match.index + match[0].length)).length
          },
          features: [{
            $type: 'app.bsky.richtext.facet#mention',
            did: profile.data.did
          }]
        });
      }
    } catch (err) {
      console.log(`⚠️ Skipped invalid mention: @${handle}`);
    }
  }
  return mentions;
}

/* نشر منشور */
async function postToBluesky(text, agent) {
  const cleanText = text.trim();
  const lines = cleanText.split('\n');
  const lastLine = lines[lines.length - 1].trim();

  let facets = [];
  let embed = undefined;

  if (/^https?:\/\/\S+$/i.test(lastLine)) {
    facets = generateFacet(cleanText, lastLine);

    const randomIndex = Math.floor(Math.random() * 10) + 1; // من 1 إلى 10
const imagePath = path.join(__dirname, 'public', `${randomIndex}.png`);
    const imageBytes = fs.readFileSync(imagePath);
    const blob = await agent.uploadBlob(imageBytes, { encoding: 'image/png' });

    embed = {
      $type: 'app.bsky.embed.external',
      external: {
        uri: lastLine,
        title: "🌍Save a Life, Support a Future",
        description: "🌍 Father's call: Help me survive me and my children in the war",
        thumb: blob.data.blob
      }
    };
  }

  const mentionFacets = await createMentionFacets(cleanText, agent);
  facets = facets.concat(mentionFacets);

  await agent.post({ text: cleanText, facets, embed });
  logToFile(`✅ Posted: ${cleanText}`);
  await delay(60000);
}

/* تسجيل في ملف */
function logToFile(message) {
  const time = new Date().toISOString();
  fs.appendFileSync('logs.txt', `[${time}] ${message}\n`);
}

/* بدء النشر لكل حساب */
async function startPostingForAccount(account) {
  while (account.currentIndex < account.postsQueue.length && !account.paused) {
    try {
      await postToBluesky(account.postsQueue[account.currentIndex], account.agent);
      account.totalPosted++;
      account.currentIndex++;
    } catch (err) {
      logToFile(`❌ Error for ${account.handle}: ${err.message}`);
    }
  }
  if (account.currentIndex >= account.postsQueue.length) {
    logToFile(`✅ All posts done for ${account.handle}`);
  }
}

/* بدء كل الحسابات */
app.post('/start', async (req, res) => {
  try {
    const { accounts, link } = req.body;
    donationLink = link;

    if (!Array.isArray(accounts) || accounts.length === 0) {
      return res.status(400).json({ error: 'No accounts provided' });
    }

    runningAccounts = [];

    for (const acc of accounts) {
      const agent = new BskyAgent({ service: 'https://bsky.social' });

      try {
        await agent.login({
          identifier: acc.handle.trim(),
          password: acc.appPassword.trim()
        });

        const queue = loadPostsFromExcel().map(p => {
          const mentions = getNextMentions();
          const text = `${mentions}\n${p.trim()}\n\n${donationLink}`;
          return text.length > 300 ? text.substring(0, 297) + "..." : text;
        });

        runningAccounts.push({
          handle: acc.handle,
          agent,
          postsQueue: queue,
          currentIndex: 0,
          totalPosted: 0,
          paused: false
        });

        startPostingForAccount(runningAccounts[runningAccounts.length - 1]);

        console.log(`✅ Logged in: ${acc.handle}`);
      } catch (loginErr) {
        console.error(`❌ Login failed for ${acc.handle}:`, loginErr.message);
      }
    }

    if (runningAccounts.length === 0) {
      console.error("❌ Failed to login to all accounts.");
      return res.status(500).json({ error: 'Failed to login to all accounts.' });
    }

    res.json({ message: '✅ Started posting for all valid accounts.' });

  } catch (err) {
    console.error("❌ Unexpected error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/pause', (req, res) => {
  const { handle } = req.body;
  const acc = runningAccounts.find(a => a.handle === handle);
  if (acc) {
    acc.paused = true;
    logToFile(`⏸️ Paused: ${acc.handle}`);
  }
  res.json({ message: `Paused ${handle}` });
});

app.post('/resume', (req, res) => {
  const { handle } = req.body;
  const acc = runningAccounts.find(a => a.handle === handle);
  if (acc && acc.paused) {
    acc.paused = false;
    logToFile(`▶️ Resumed: ${acc.handle}`);
    startPostingForAccount(acc);
  }
  res.json({ message: `Resumed ${handle}` });
});

app.post('/stop', (req, res) => {
  for (const acc of runningAccounts) {
    acc.paused = true;
    acc.currentIndex = acc.postsQueue.length;
  }
  logToFile(`🛑 All accounts stopped`);
  res.json({ message: 'All accounts stopped.' });
});

app.get('/status', (req, res) => {
  const status = runningAccounts.map(acc => ({
    handle: acc.handle,
    totalPosted: acc.totalPosted,
    remaining: acc.postsQueue.length - acc.currentIndex,
    paused: acc.paused
  }));
  res.json({ status });
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
