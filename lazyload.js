document.addEventListener('DOMContentLoaded', function () {
    const images = document.querySelectorAll('.lazyload');

    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                // Get the image and update the src attribute
                const img = entry.target;
                const networkSpeed = navigator.connection ? navigator.connection.downlink : 1;
                let src = img.getAttribute('src');
                // Change image source based on network speed
                if (networkSpeed > 2) {
                    src = src.replace('low', 'high');
                } else if (networkSpeed > 0) {
                    src = src.replace('low', 'med');
                }

                img.src = src;
                observer.unobserve(img); // Stop observing after loading
            }
        });
    }, { rootMargin: "200px" });

    // Start observing each image
    images.forEach(img => observer.observe(img));
});
