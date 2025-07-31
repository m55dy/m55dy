const accountsContainer = document.getElementById('accounts-container');
const addAccountBtn = document.getElementById('add-account');
const form = document.getElementById('accounts-form');
const statusDiv = document.getElementById('status');

function createAccountEntry() {
  const div = document.createElement('div');
  div.className = 'account-entry';

  const inputHandle = document.createElement('input');
  inputHandle.type = 'text';
  inputHandle.name = 'handle';
  inputHandle.placeholder = 'اسم المستخدم (handle)';
  inputHandle.required = true;

  const inputPassword = document.createElement('input');
  inputPassword.type = 'password';
  inputPassword.name = 'appPassword';
  inputPassword.placeholder = 'كلمة مرور التطبيق (app password)';
  inputPassword.required = true;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'remove-account';
  removeBtn.title = 'حذف الحساب';
  removeBtn.textContent = '×';
  removeBtn.onclick = () => div.remove();

  div.appendChild(inputHandle);
  div.appendChild(inputPassword);
  div.appendChild(removeBtn);

  return div;
}

addAccountBtn.addEventListener('click', () => {
  const entry = createAccountEntry();
  accountsContainer.appendChild(entry);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(form);
  const donationLink = formData.get('donationLink') || '';

  // جمع الحسابات
  const handles = formData.getAll('handle');
  const passwords = formData.getAll('appPassword');

  if (handles.length === 0) {
    alert('يرجى إضافة حساب واحد على الأقل');
    return;
  }

  const accounts = handles.map((handle, i) => ({
    handle: handle.trim(),
    appPassword: passwords[i].trim()
  }));

  try {
    const res = await fetch('/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accounts, link: donationLink })
    });
    const data = await res.json();
    alert(data.message || data.error);

    if (res.ok) {
      updateStatusLoop();
    }
  } catch (err) {
    alert('حدث خطأ أثناء الاتصال بالسيرفر');
    console.error(err);
  }
});

document.getElementById('pauseAll').addEventListener('click', async () => {
  await controlAllAccounts('pause');
});

document.getElementById('resumeAll').addEventListener('click', async () => {
  await controlAllAccounts('resume');
});

document.getElementById('stopAll').addEventListener('click', async () => {
  const res = await fetch('/stop', { method: 'POST' });
  const data = await res.json();
  alert(data.message || data.error);
});

async function controlAllAccounts(action) {
  const resStatus = await fetch('/status');
  const statusData = await resStatus.json();
  const accounts = statusData.status || [];

  for (const acc of accounts) {
    await fetch(`/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: acc.handle })
    });
  }

  alert(`تم ${action} جميع الحسابات`);
  if (action === 'resume') updateStatusLoop();
}

async function updateStatusLoop() {
  try {
    const res = await fetch('/status');
    const data = await res.json();
    if (!data.status) return;

    statusDiv.innerHTML = '';
    for (const acc of data.status) {
      const div = document.createElement('div');
      div.className = 'account-status';
      div.textContent = `[${acc.handle}] - المنشورات المنشورة: ${acc.totalPosted} - المتبقي: ${acc.remaining} - ${acc.paused ? 'موقوف' : 'يعمل'}`;
      statusDiv.appendChild(div);
    }

    // تحديث كل 5 ثواني طالما النشر مستمر
    if (data.status.some(acc => !acc.paused && acc.remaining > 0)) {
      setTimeout(updateStatusLoop, 5000);
    }
  } catch (err) {
    console.error('خطأ تحديث الحالة:', err);
  }
}
