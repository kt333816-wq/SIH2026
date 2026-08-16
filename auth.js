const API_BASE = window.SERVISO_API_BASE;

let selectedRole = null;
let selectedSubRole = null;
let signupTurnstileToken = null;
let loginTurnstileToken = null;
let pendingUserId = null;
let pendingUserEmail = null;

// Called by Cloudflare Turnstile widgets via data-callback
function onSignupTurnstile(token) { signupTurnstileToken = token; }
function onLoginTurnstile(token) { loginTurnstileToken = token; }

const DOC_LABELS = {
    restaurant_canteen: 'Upload FSSAI / Food License',
    ngo_head: 'Upload NGO Registration Certificate',
    social_worker_politician: 'Upload Aadhaar Card (front & back)'
};

const ROLE_LABELS = {
    civilian: 'Signing up as an individual donor',
    restaurant_canteen: 'Signing up as a restaurant / govt canteen donor',
    ngo_head: 'Signing up as an NGO head (receiver)',
    social_worker_politician: 'Signing up as a social worker / public representative (receiver)'
};

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initCategorySelection();
    initRoleSelection();
    initSignupForm();
    initOtpForm();
    initLoginForm();

    document.getElementById('back-to-category').addEventListener('click', () => showSignupStep('category'));
    document.getElementById('back-to-role').addEventListener('click', () => showSignupStep('role'));
    document.getElementById('go-to-login').addEventListener('click', () => {
        switchTab('login');
        showSignupStep('category');
    });
    document.getElementById('resend-otp').addEventListener('click', resendOtp);
});

function initTabs() {
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
}

function switchTab(name) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.getElementById('panel-login').classList.toggle('active', name === 'login');
    document.getElementById('panel-signup').classList.toggle('active', name === 'signup');
    clearAlert();
}

function initCategorySelection() {
    document.querySelectorAll('.category-card').forEach(card => {
        card.addEventListener('click', () => {
            const category = card.dataset.category; // 'donor' | 'receiver'
            document.getElementById('role-step-heading').textContent =
                category === 'donor' ? 'What kind of donor?' : 'What kind of receiver?';
            document.getElementById('role-step-sub').textContent = 'Choose the option that fits you';

            document.getElementById('donor-role-grid').classList.toggle('visible', category === 'donor');
            document.getElementById('receiver-role-grid').classList.toggle('visible', category === 'receiver');

            showSignupStep('role');
        });
    });
}

function initRoleSelection() {
    document.querySelectorAll('.role-card').forEach(card => {
        card.addEventListener('click', () => {
            selectedRole = card.dataset.role;
            selectedSubRole = card.dataset.subrole;
            document.getElementById('selected-role-label').textContent = ROLE_LABELS[selectedSubRole];

            const aadhaarField = document.getElementById('field-aadhaar');
            const docField = document.getElementById('field-document');
            const aadhaarInput = document.getElementById('su-aadhaar');
            const docInput = document.getElementById('su-document');

            aadhaarField.classList.toggle('visible', selectedSubRole === 'social_worker_politician');
            aadhaarInput.required = selectedSubRole === 'social_worker_politician';

            const needsDoc = selectedSubRole in DOC_LABELS;
            docField.classList.toggle('visible', needsDoc);
            docInput.required = needsDoc;
            if (needsDoc) document.getElementById('document-label').textContent = DOC_LABELS[selectedSubRole];

            showSignupStep('details');
        });
    });
}

function showSignupStep(step) {
    document.querySelectorAll('.signup-step').forEach(s => s.classList.remove('active'));
    document.getElementById(`signup-step-${step}`).classList.add('active');
    clearAlert();
}

function showAlert(message, isError = true) {
    const el = document.getElementById('auth-alert');
    el.textContent = message;
    el.classList.remove('hidden');
    el.classList.toggle('error', isError);
}

function clearAlert() {
    const el = document.getElementById('auth-alert');
    el.classList.add('hidden');
}

function initSignupForm() {
    document.getElementById('signup-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        clearAlert();

        if (!signupTurnstileToken) {
            showAlert('Please complete the captcha challenge.');
            return;
        }

        const formData = new FormData();
        formData.append('name', document.getElementById('su-name').value.trim());
        formData.append('email', document.getElementById('su-email').value.trim());
        formData.append('mobile', document.getElementById('su-mobile').value.trim());
        formData.append('password', document.getElementById('su-password').value);
        formData.append('role', selectedRole);
        formData.append('sub_role', selectedSubRole);
        formData.append('turnstileToken', signupTurnstileToken);

        if (selectedSubRole === 'social_worker_politician') {
            formData.append('aadhaar_number', document.getElementById('su-aadhaar').value.trim());
        }
        const docInput = document.getElementById('su-document');
        if (docInput.files[0]) formData.append('document', docInput.files[0]);

        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating account...';

        try {
            const res = await fetch(`${API_BASE}/auth/signup`, { method: 'POST', body: formData });
            const data = await res.json();

            if (!res.ok) {
                showAlert(data.error || 'Signup failed');
                return;
            }

            pendingUserId = data.userId;
            pendingUserEmail = document.getElementById('su-email').value.trim();
            document.getElementById('otp-email-display').textContent = pendingUserEmail;
            showSignupStep('otp');
        } catch (err) {
            showAlert('Could not reach the server. Please try again.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create Account';
        }
    });
}

function initOtpForm() {
    document.getElementById('otp-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        clearAlert();

        const code = document.getElementById('otp-code').value.trim();
        try {
            const res = await fetch(`${API_BASE}/auth/verify-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: pendingUserId, code })
            });
            const data = await res.json();

            if (!res.ok) {
                showAlert(data.error || 'Verification failed');
                return;
            }

            document.getElementById('done-heading').textContent = 'Account active';
            document.getElementById('done-message').textContent = data.message || 'Your account is ready. You can log in now.';
            showSignupStep('done');
        } catch (err) {
            showAlert('Could not reach the server. Please try again.');
        }
    });
}

async function resendOtp() {
    clearAlert();
    try {
        const res = await fetch(`${API_BASE}/auth/resend-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: pendingUserId })
        });
        const data = await res.json();
        showAlert(data.message || data.error, !res.ok);
    } catch (err) {
        showAlert('Could not reach the server. Please try again.');
    }
}

function initLoginForm() {
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        clearAlert();

        if (!loginTurnstileToken) {
            showAlert('Please complete the captcha challenge.');
            return;
        }

        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;

        try {
            const res = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, turnstileToken: loginTurnstileToken })
            });
            const data = await res.json();

            if (!res.ok) {
                showAlert(data.error || 'Login failed');
                return;
            }

            localStorage.setItem('serviso_token', data.token);
            localStorage.setItem('serviso_user', JSON.stringify(data.user));
            window.location.href = 'index.html';
        } catch (err) {
            showAlert('Could not reach the server. Please try again.');
        }
    });
}
