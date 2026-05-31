// API base URL - change for dev/prod
const API_BASE = (() => {
    const host = location.hostname;
    if (host === 'danbotlab.com' || host.endsWith('.danbotlab.com')) return 'https://api.danbotlab.com';
    if (host === 'danielmarkjones.com' || host.endsWith('.danielmarkjones.com')) return 'https://api.danielmarkjones.com';
    return 'https://api.danbotlab';
})();

export { API_BASE }
