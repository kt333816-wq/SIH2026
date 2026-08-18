document.addEventListener("DOMContentLoaded", function () {
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

window.addEventListener("load", () => {
    if (window.location.hash) {
        const target = document.querySelector(window.location.hash);
        if (target) {
            setTimeout(() => {
                target.scrollIntoView({ behavior: "auto", block: "start" });
            }, 400);
        }
    }
});