document.addEventListener('DOMContentLoaded', () => {
    const receiverBtn = document.getElementById('btn-receiver-portal');
    const receiverModal = document.getElementById('receiver-modal');
    const closeModalBtn = document.getElementById('btn-close-modal');
    const receiverForm = document.getElementById('receiver-form');

    // Currently logged-in user ID (Retrieved from session/localStorage)
    const currentUserId = localStorage.getItem('userId');

    // 1. Toggle Receiver Modal
    if (receiverBtn) {
        receiverBtn.addEventListener('click', () => {
            receiverModal.style.display = 'block';
        });
    }

    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            receiverModal.style.display = 'none';
        });
    }

    // 2. Submit Receiver Info with Geolocation
    if (receiverForm) {
        receiverForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const fullAddress = document.getElementById('receiver-address').value;
            const feedPreference = document.getElementById('receiver-feed-pref').value;

            if (!navigator.geolocation) {
                alert('Geolocation is not supported by your browser.');
                return;
            }

            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const latitude = position.coords.latitude;
                    const longitude = position.coords.longitude;

                    try {
                        const res = await fetch('/api/food/receiver/profile', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                userId: currentUserId,
                                fullAddress: fullAddress,
                                feedPreference: feedPreference,
                                latitude: latitude,
                                longitude: longitude
                            })
                        });

                        const data = await res.json();
                        if (data.success) {
                            alert('Location and preferences saved! Searching for nearby donors...');
                            receiverModal.style.display = 'none';
                        } else {
                            alert('Error: ' + data.error);
                        }
                    } catch (err) {
                        console.error(err);
                        alert('Failed to connect to backend.');
                    }
                },
                (error) => {
                    alert('Location access is required to compute distance to nearby donors.');
                }
            );
        });
    }
});