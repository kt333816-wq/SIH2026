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
    initSessionState();
    initDonateForm();

    document.getElementById('back-to-category').addEventListener('click', () => showSignupStep('category'));
    document.getElementById('back-to-role').addEventListener('click', () => showSignupStep('role'));
    document.getElementById('go-to-login').addEventListener('click', () => {
        switchTab('login');
        showSignupStep('category');
    });
    document.getElementById('resend-otp').addEventListener('click', resendOtp);
});

// ---------------------------------------------------------------------------
// Session state: if a valid token is already stored, skip login/signup
// entirely and show the person their own interface instead.
// ---------------------------------------------------------------------------
function getStoredUser() {
    try {
        const token = localStorage.getItem('serviso_token');
        const user = JSON.parse(localStorage.getItem('serviso_user') || 'null');
        return token && user ? user : null;
    } catch {
        return null;
    }
}

function initSessionState() {
    const user = getStoredUser();
    const formsWrapper = document.getElementById('auth-forms-wrapper');
    const loggedInPanel = document.getElementById('logged-in-panel');

    if (!user) {
        formsWrapper.style.display = '';
        loggedInPanel.style.display = 'none';
        return;
    }

    formsWrapper.style.display = 'none';
    loggedInPanel.style.display = 'block';
    document.getElementById('logged-in-name').textContent = user.name;
    document.getElementById('logged-in-role-label').textContent =
        user.role === 'donor' ? "You're signed in as a donor." : "You're signed in as a receiver.";

    const donateLink = document.getElementById('logged-in-donate-link');
    if (user.role === 'donor') donateLink.style.display = 'inline-block';

    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.removeItem('serviso_token');
        localStorage.removeItem('serviso_user');
        window.location.reload();
    });
}

// ---------------------------------------------------------------------------
// Donate form: only a logged-in donor can actually submit a listing.
// Anyone else gets sent up to the login/signup card instead of silently
// failing or pretending it worked.
// ---------------------------------------------------------------------------
function initDonateForm() {
    const form = document.getElementById('donate-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const alertEl = document.getElementById('donate-alert');
        const showDonateAlert = (msg, isError = true) => {
            alertEl.textContent = msg;
            alertEl.classList.remove('hidden');
            alertEl.classList.toggle('error', isError);
        };

        const user = getStoredUser();
        const token = localStorage.getItem('serviso_token');

        if (!user || !token) {
            showDonateAlert("You'll need to log in or sign up before listing food - taking you there now.");
            window.location.hash = '#home';
            document.getElementById('home').scrollIntoView({ behavior: 'smooth' });
            return;
        }

        if (user.role !== 'donor') {
            showDonateAlert('Only donor accounts can list food. You\'re signed in as a receiver.');
            return;
        }

        const foodQuantity = document.getElementById('food-qty').value.trim();
        const address = document.getElementById('donor-address').value.trim();

        try {
            const res = await fetch(`${API_BASE}/listings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ food_quantity: foodQuantity, address })
            });
            const data = await res.json();

            if (!res.ok) {
                showDonateAlert(data.error || 'Could not create the listing');
                return;
            }

            showDonateAlert('Listing posted - thank you!', false);
            form.reset();
        } catch (err) {
            showDonateAlert('Could not reach the server. Please try again.');
        }
    });
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
            initSessionState();
            clearAlert();
        } catch (err) {
            showAlert('Could not reach the server. Please try again.');
        }
    });
}
