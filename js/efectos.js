        // Rotating tagline — SLOWER interval (7s instead of 3.5s)
        (function() {
            const slides = document.querySelectorAll('.tagline-slide');
            let current = 0;
            setInterval(() => {
                slides[current].classList.remove('active');
                slides[current].classList.add('exit');
                const prev = current;
                setTimeout(() => { slides[prev].classList.remove('exit'); }, 1200);
                current = (current + 1) % slides.length;
                slides[current].classList.add('active');
            }, 7000);
        })();

        // Intersection Observer for scroll reveals
        (function() {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('visible');
                        observer.unobserve(entry.target);
                    }
                });
            }, { threshold: 0.1 });
            document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
        })();
