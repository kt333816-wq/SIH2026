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

// Belt-and-braces: block the default browser submit on the donate form the
// instant this script loads, before anything else runs. If everything else
// in this file works fine, initDonateForm() below replaces this with the
// full logged-in-check/gate behavior. If something else in this file throws,
// this listener alone still stops the "reload the page and jump to whatever
// #hash happens to be in the URL" behavior.
document.addEventListener('submit', (e) => {
    if (e.target && e.target.id === 'donate-form' && !e.target.dataset.servisoBound) {
        e.preventDefault();
    }
}, true);

document.addEventListener('DOMContentLoaded', () => {
    const safeInit = (name, fn) => {
        try { fn(); } catch (err) { console.error(`Serviso auth: ${name} failed to initialize:`, err); }
    };

    safeInit('initTabs', initTabs);
    safeInit('initCategorySelection', initCategorySelection);
    safeInit('initRoleSelection', initRoleSelection);
    safeInit('initSignupForm', initSignupForm);
    safeInit('initOtpForm', initOtpForm);
    safeInit('initLoginForm', initLoginForm);
    safeInit('initSessionState', initSessionState);
    safeInit('initDonateForm', initDonateForm);
    safeInit('initVerifyPickupForm', initVerifyPickupForm);
    safeInit('initReceiverForm', initReceiverForm);
    safeInit('initReceiverLiveLocation', initReceiverLiveLocation);
    safeInit('initReceiverShareLocationButton', initReceiverShareLocationButton);

    safeInit('backToCategory', () => {
        document.getElementById('back-to-category').addEventListener('click', () => showSignupStep('category'));
    });
    safeInit('backToRole', () => {
        document.getElementById('back-to-role').addEventListener('click', () => showSignupStep('role'));
    });
    safeInit('goToLogin', () => {
        document.getElementById('go-to-login').addEventListener('click', () => {
            switchTab('login');
            showSignupStep('category');
        });
    });
    safeInit('resendOtpBtn', () => {
        document.getElementById('resend-otp').addEventListener('click', resendOtp);
    });
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

    const receiverLink = document.getElementById('logged-in-receiver-link');
    if (user.role === 'receiver') receiverLink.style.display = 'inline-block';

    if (user.role === 'donor') loadDonorStatusPanel();

    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.removeItem('serviso_token');
        localStorage.removeItem('serviso_user');
        window.location.reload();
    });
}

// ---------------------------------------------------------------------------
// Donor status panel: rating (shown to every donor) and the AI surplus
// prediction (restaurant/govt canteen accounts only). Loaded once, right
// after a donor's session is confirmed.
// ---------------------------------------------------------------------------
async function loadDonorStatusPanel() {
    const token = localStorage.getItem('serviso_token');
    const panel = document.getElementById('donor-status-panel');
    const ratingLine = document.getElementById('donor-rating-line');
    const aiPanel = document.getElementById('ai-prediction-panel');
    const aiText = document.getElementById('ai-prediction-text');

    try {
        const res = await fetch(`${API_BASE}/donor/profile`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) return;

        panel.classList.remove('hidden');
        ratingLine.textContent =
            `⭐ ${data.rating.toFixed(1)} / 5 - ${data.completedDonationsCount} completed donation${data.completedDonationsCount === 1 ? '' : 's'}`;

        if (data.showSurplusPrediction) {
            aiPanel.classList.remove('hidden');
            try {
                const predRes = await fetch(`${API_BASE}/donor/surplus-prediction`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const predData = await predRes.json();
                aiText.textContent = predData.hasEnoughData
                    ? predData.message
                    : predData.message || 'Not enough listing history yet to predict.';
            } catch {
                aiText.textContent = 'Could not load a prediction right now.';
            }
        }
    } catch {
        // Non-critical panel - fail silently and just leave it hidden.
    }
}

// ---------------------------------------------------------------------------
// Donate form: only a logged-in donor can actually submit a listing.
// Anyone else gets sent up to the login/signup card instead of silently
// failing or pretending it worked.
// ---------------------------------------------------------------------------
function initDonateForm() {
    const form = document.getElementById('donate-form');
    if (!form) return;
    form.dataset.servisoBound = 'true';

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

            showDonateAlert(data.message || 'Listing posted - thank you!', false);
            form.reset();

            if (data.matched) {
                currentListingId = data.listingId;
                const panel = document.getElementById('pickup-match-panel');
                const msg = document.getElementById('pickup-match-message');
                panel.classList.remove('hidden');
                msg.innerHTML = `Matched! Ask the receiver for their pickup code when they arrive, and enter it below to confirm the handover.${data.otpExpiresAt ? `<br>Valid until ${new Date(data.otpExpiresAt).toLocaleTimeString()}.` : ''}`;
                donorTrackingMap.start(data.listingId);
            }
        } catch (err) {
            showDonateAlert('Could not reach the server. Please try again.');
        }
    });
}

let currentListingId = null;
let receiverCurrentListingId = null;

// ---------------------------------------------------------------------------
// Generic live tracking map - used independently by both the donor's and
// receiver's match panels (separate map/marker/poll state each, so the two
// never collide if both happened to be open, e.g. two tabs on one machine).
// ---------------------------------------------------------------------------
function createTrackingMap(mapElId, distanceElId) {
    let map = null;
    let donorMarker = null;
    let receiverMarker = null;
    let pollHandle = null;

    function start(listingId) {
        const token = localStorage.getItem('serviso_token');
        const mapEl = document.getElementById(mapElId);
        const distanceEl = document.getElementById(distanceElId);
        if (!mapEl || typeof L === 'undefined') return;

        if (!map) {
            map = L.map(mapElId);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors',
                maxZoom: 19
            }).addTo(map);
        }

        const poll = async () => {
            try {
                const res = await fetch(`${API_BASE}/listings/${listingId}/tracking`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const data = await res.json();
                if (!res.ok) return;

                const donorLatLng = [data.donorLocation.lat, data.donorLocation.lon];
                if (!donorMarker) {
                    donorMarker = L.marker(donorLatLng).addTo(map).bindPopup('Pickup point');
                    map.setView(donorLatLng, 13);
                }

                if (data.receiverLocation) {
                    const receiverLatLng = [data.receiverLocation.lat, data.receiverLocation.lon];
                    if (!receiverMarker) {
                        receiverMarker = L.marker(receiverLatLng).addTo(map).bindPopup('Receiver - live');
                    } else {
                        receiverMarker.setLatLng(receiverLatLng);
                    }
                    map.fitBounds([donorLatLng, receiverLatLng], { padding: [30, 30] });

                    const km = (data.distanceMeters / 1000).toFixed(2);
                    distanceEl.textContent = `Receiver is ${km} km away - last updated ${new Date(data.receiverLocation.updatedAt).toLocaleTimeString()}`;
                } else {
                    distanceEl.textContent = 'Waiting for the receiver to share their live location...';
                }

                if (data.matchStatus === 'completed' || data.matchStatus === 'searching_animal') {
                    clearInterval(pollHandle);
                    distanceEl.textContent = data.matchStatus === 'completed'
                        ? 'Pickup completed - tracking stopped.'
                        : 'This match fell through - no longer tracking.';
                }
            } catch {
                // Transient network issue - next poll will retry.
            }
        };

        poll();
        clearInterval(pollHandle);
        pollHandle = setInterval(poll, 15000);
    }

    return { start };
}

const donorTrackingMap = createTrackingMap('tracking-map', 'tracking-distance');
const receiverTrackingMap = createTrackingMap('receiver-tracking-map', 'receiver-tracking-distance');

// ---------------------------------------------------------------------------
// Pickup confirmation (donor side): the donor asks the matched receiver for
// their code at handover and enters it here. A correct code completes the
// listing and stops the search on the backend.
// ---------------------------------------------------------------------------
function initVerifyPickupForm() {
    const form = document.getElementById('verify-pickup-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const token = localStorage.getItem('serviso_token');
        const msg = document.getElementById('pickup-match-message');

        if (!currentListingId) {
            msg.textContent = 'No active listing to confirm - refresh and try posting again.';
            return;
        }

        const otp = document.getElementById('verify-otp').value.trim();

        try {
            const res = await fetch(`${API_BASE}/listings/${currentListingId}/verify-pickup`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ otp })
            });
            const data = await res.json();

            if (!res.ok) {
                msg.textContent = data.error || 'Could not confirm pickup';
                return;
            }

            msg.textContent = data.message || 'Pickup confirmed - thank you!';
            document.getElementById('verify-pickup-form').reset();
            loadDonorStatusPanel(); // refresh rating/count now that a donation completed
        } catch (err) {
            msg.textContent = 'Could not reach the server. Please try again.';
        }
    });
}

// ---------------------------------------------------------------------------
// Receiver form: save/update the receiver's address + feed preference.
// Only a logged-in receiver can submit this; same gate pattern as donate form.
// ---------------------------------------------------------------------------
function initReceiverForm() {
    const form = document.getElementById('receiver-form');
    if (!form) return;
    form.dataset.servisoBound = 'true';

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const alertEl = document.getElementById('receiver-alert');
        const showReceiverAlert = (msg, isError = true) => {
            alertEl.textContent = msg;
            alertEl.classList.remove('hidden');
            alertEl.classList.toggle('error', isError);
        };

        const user = getStoredUser();
        const token = localStorage.getItem('serviso_token');

        if (!user || !token) {
            showReceiverAlert("You'll need to log in or sign up before setting up your receiver profile - taking you there now.");
            window.location.hash = '#home';
            document.getElementById('home').scrollIntoView({ behavior: 'smooth' });
            return;
        }

        if (user.role !== 'receiver') {
            showReceiverAlert('Only receiver accounts (NGO / social worker) can set up a receiver profile.');
            return;
        }

        const fullAddress = document.getElementById('receiver-address').value.trim();
        const feedPreference = document.getElementById('receiver-feed-pref').value;
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        try {
            const res = await fetch(`${API_BASE}/receiver/profile`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ full_address: fullAddress, feed_preference: feedPreference })
            });
            const data = await res.json();

            if (!res.ok) {
                showReceiverAlert(data.error || 'Could not save your profile');
                return;
            }

            showReceiverAlert('Profile saved - we\'ll match you with nearby donations.', false);
        } catch (err) {
            showReceiverAlert('Could not reach the server. Please try again.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save & Find Donations';
        }
    });
}

// ---------------------------------------------------------------------------
// Receiver match panel: polls for an active match (a match can appear at any
// time after the profile is saved, not just at page load), then shows the
// receiver's own pickup code, the donor's address, the tracking map, and
// live-location sharing.
// ---------------------------------------------------------------------------
let receiverMatchPollHandle = null;

function initReceiverLiveLocation() {
    const user = getStoredUser();
    if (!user || user.role !== 'receiver') return;

    checkReceiverMatch();
    clearInterval(receiverMatchPollHandle);
    receiverMatchPollHandle = setInterval(checkReceiverMatch, 15000);
}

async function checkReceiverMatch() {
    const token = localStorage.getItem('serviso_token');
    let currentMatch;
    try {
        const res = await fetch(`${API_BASE}/receiver/current-match`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) return;
        currentMatch = data.match;
    } catch {
        return;
    }

    const panel = document.getElementById('receiver-match-panel');

    if (!currentMatch) {
        panel.classList.add('hidden');
        receiverCurrentListingId = null;
        return;
    }

    // Already showing this match - don't restart the map/poll every 15s.
    if (receiverCurrentListingId === currentMatch.listing_id) return;

    receiverCurrentListingId = currentMatch.listing_id;
    panel.classList.remove('hidden');
    document.getElementById('receiver-match-message').textContent =
        "You've been matched! Head to the pickup point shown below and tell the donor your code once you're there.";
    document.getElementById('receiver-otp-code').textContent = currentMatch.pickup_otp || '';
    document.getElementById('receiver-donor-address').textContent =
        `Pickup: ${currentMatch.food_quantity || ''} at ${currentMatch.donor_address || 'address unavailable'}`;
    receiverTrackingMap.start(currentMatch.listing_id);
}

// ---------------------------------------------------------------------------
// Receiver live-location sharing - posts a snapshot every 20s while toggled
// on, rather than continuous GPS watch, to go easy on battery. Only shown at
// all once the receiver has an active matched listing (see checkReceiverMatch).
// ---------------------------------------------------------------------------
let liveLocationInterval = null;

function initReceiverShareLocationButton() {
    const btn = document.getElementById('receiver-share-location-btn');
    const statusEl = document.getElementById('receiver-share-status');
    if (!btn) return;

    btn.addEventListener('click', () => {
        if (liveLocationInterval) {
            clearInterval(liveLocationInterval);
            liveLocationInterval = null;
            btn.textContent = 'Share My Live Location';
            statusEl.textContent = 'Location sharing stopped.';
            return;
        }

        if (!navigator.geolocation) {
            statusEl.textContent = 'Your browser does not support location sharing.';
            return;
        }

        const sendPosition = () => {
            navigator.geolocation.getCurrentPosition(async (pos) => {
                const token = localStorage.getItem('serviso_token');
                try {
                    const res = await fetch(`${API_BASE}/receiver/live-location`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${token}`
                        },
                        body: JSON.stringify({ lat: pos.coords.latitude, lon: pos.coords.longitude })
                    });
                    const data = await res.json();
                    if (!res.ok) {
                        statusEl.textContent = data.error || 'Could not send your location just now - will retry.';
                        return;
                    }
                    statusEl.textContent = `Sharing live location - last sent ${new Date().toLocaleTimeString()}`;
                } catch {
                    statusEl.textContent = 'Could not reach the server - will retry.';
                }
            }, () => {
                statusEl.textContent = "Location permission denied - the donor won't see you on the map.";
            });
        };

        sendPosition();
        liveLocationInterval = setInterval(sendPosition, 20000);
        btn.textContent = 'Stop Sharing Location';
    });
}

function initCategorySelection() {
    document.querySelectorAll('.category-card').forEach(card => {
        card.addEventListener('click', () => {
            const category = card.dataset.category; // 'donor' | 'receiver'
            document.getElementById('role-step-heading').textContent =
                category === 'donor' ? 'What kind of donor?' : 'What kind of receiver?';
            document.getElementById('role-step-sub').textContent =
                category === 'donor' ? 'Choose the option that fits you' : 'Choose the option that fits you';

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