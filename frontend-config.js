// Public URL only. Local Express remains same-origin; the student site uses Render.
window.PERICLES_CONFIG = {
  backendUrl: window.location.hostname === 'anjapope.github.io'
    ? 'https://pericles-api.onrender.com' : ''
};
