const lazyObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            // Get the image and update the src attribute
            const img = entry.target;
            const networkSpeed = navigator.connection ? navigator.connection.downlink : 1;
            let src = img.getAttribute('src');
            // Change image source based on network speed
            if (networkSpeed > 2) {
                src = src.replace('/low/', '/high/');
            } else if (networkSpeed > 0) {
                src = src.replace('/low/', '/med/');
            }

            img.src = src;
            lazyObserver.unobserve(img); // Stop observing after loading
            set_up_zoomable(img);
        }
    });
}, { rootMargin: "200px" });

// Observe any .lazyload images not yet being watched. Safe to call repeatedly
// (e.g. after async grid build); a data flag prevents double-observation.
function observe_lazy_images() {
    document.querySelectorAll('.lazyload').forEach(img => {
        if (!img.dataset.lazyObserved) {
            img.dataset.lazyObserved = "1";
            lazyObserver.observe(img);
        }
    });
}

document.addEventListener('DOMContentLoaded', observe_lazy_images);

const viewer = document.getElementById('image-viewer');
const fullImage = document.getElementById('full-image');
const closeBtn = document.getElementById('close-btn');
const caption = document.getElementById('full-image-caption');

function set_up_zoomable(image){
    let src = image.getAttribute('src')
    image.dataset.full = src.replace('/low/', '/high/')
    if (src.includes('/med/')){
        image.dataset.full = src.replace('/med/', '/high/')
    }
    image.addEventListener('click', () => {
        console.log('click')
        const fullSrc = image.dataset.full;
        fullImage.src = fullSrc;
        viewer.style.display = 'flex';
        caption.style.display = 'flex';
        if(image.title){
            caption.innerHTML = image.title;
        }
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
    caption.style.display = 'none';
    caption.innerHTML = "";
    zoomed = false;
    fullImage.style.transform = 'scale(1)';
    fullImage.style.cursor = 'zoom-in';
    fullImage.style.transformOrigin = 'center center';
    fullImage.src = "";
}

fullImage.addEventListener('click', (e) => {
    if (!zoomed) {
    // Anchor the zoom at the click point so it scales up from there.
    // Use offsetX/offsetWidth (the click position in the image's own layout
    // coordinates) rather than getBoundingClientRect, which is distorted by
    // the current transform/transition and would land the origin off-target.
    const originX = (e.offsetX / fullImage.offsetWidth) * 100;
    const originY = (e.offsetY / fullImage.offsetHeight) * 100;
    fullImage.style.transformOrigin = `${originX}% ${originY}%`;
    fullImage.style.transform = 'scale(3)';
    fullImage.style.cursor = 'zoom-out';
    } else {
    // Zoom back out from wherever it currently is; keep the existing origin.
    fullImage.style.transform = 'scale(1)';
    fullImage.style.cursor = 'zoom-in';
    }

    zoomed = !zoomed;
});