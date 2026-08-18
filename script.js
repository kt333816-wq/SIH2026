// Dont touch this I have no Idea how this works

document.addEventListener("DOMContentLoaded", function () {
    // 1. Scroll Animations (Intersection Observer)
    const animatedElements = document.querySelectorAll('.fade-left, .fade-right');
    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.2
    });

    animatedElements.forEach(element => {
        observer.observe(element);
    });

    // 2. Click to Copy Functionality
    const copyItems = document.querySelectorAll('.contact-info li');
    copyItems.forEach(item => {
        item.addEventListener('click', () => {
            const textToCopy = item.getAttribute('data-copy');

            navigator.clipboard.writeText(textToCopy).then(() => {
                item.classList.add('copied');
                setTimeout(() => {
                    item.classList.remove('copied');
                }, 1800);
            }).catch(err => {
                console.error('Failed to copy text: ', err);
            });
        });
    });

    // 3. Hamburger Menu Logic
    const hamburger = document.querySelector(".hamburger");
    const navbar = document.querySelector(".navbar");
    const navLinks = document.querySelectorAll(".navbar a");

    hamburger.addEventListener("click", () => {
        hamburger.classList.toggle("active");
        navbar.classList.toggle("active");
    });

    navLinks.forEach(link => {
        link.addEventListener("click", () => {
            hamburger.classList.remove("active");
            navbar.classList.remove("active");
        });
    });
});

// 4. Fix #anchor links landing in the wrong place
// If the page was opened with a URL like #app or #donate, the browser
// tries to jump there immediately - but the Cloudflare Turnstile widget
// inside the login/signup card loads asynchronously and adds extra
// height to the page a moment later, which shifts every section below
// it. That mismatch is what made #app (or #contact, #donate) sometimes
// land back at the top instead of the right section. Re-correct once
// everything has actually finished loading.
window.addEventListener("load", () => {
    if (window.location.hash) {
        const target = document.querySelector(window.location.hash);
        if (target) {
            setTimeout(() => {
                target.scrollIntoView({ behavior: "auto", block: "start" });
            }, 400); // give the Turnstile iframe a moment to finish rendering
        }
    }
});