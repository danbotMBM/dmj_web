document.addEventListener('DOMContentLoaded', function () {
    const images = document.querySelectorAll('.lazyload');

    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            console.log(entry.target)
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
                set_up_zoomable(img);
            }
        });
    }, { rootMargin: "200px" });

    // Start observing each image
    images.forEach(img => observer.observe(img));
});

const viewer = document.getElementById('image-viewer');
const fullImage = document.getElementById('full-image');
const closeBtn = document.getElementById('close-btn');

function set_up_zoomable(image){
    let src = image.getAttribute('src')
    image.dataset.full = src.replace('low', 'high')
    image.addEventListener('click', () => {
        console.log('click')
        const fullSrc = image.dataset.full;
        fullImage.src = fullSrc;
        viewer.style.display = 'flex';
        zoomed = false;
        fullImage.style.transform = 'scale(1)';
        fullImage.style.cursor = 'zoom-in';
        fullImage.style.transformOrigin = 'center center';
    });
}

let zoomed = false;


closeBtn.addEventListener('click', closeViewer);
viewer.addEventListener('click', (e) => {
    if (e.target === viewer) closeViewer();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeViewer();
});

function closeViewer() {
    viewer.style.display = 'none';
    zoomed = false;
    fullImage.style.transform = 'scale(1)';
    fullImage.style.cursor = 'zoom-in';
    fullImage.style.transformOrigin = 'center center';
}

fullImage.addEventListener('click', (e) => {
    const rect = fullImage.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    const originX = (offsetX / rect.width) * 100;
    const originY = (offsetY / rect.height) * 100;

    if (!zoomed) {
    fullImage.style.transformOrigin = `${originX}% ${originY}%`;
    fullImage.style.transform = 'scale(3)';
    fullImage.style.cursor = 'zoom-out';
    } else {
    fullImage.style.transformOrigin = `${originX}% ${originY}%`;
    fullImage.style.transform = 'scale(1)';
    fullImage.style.cursor = 'zoom-in';
    }

    zoomed = !zoomed;
});