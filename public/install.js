const installButton = document.getElementById('installAppBtn');
const installHelp = document.getElementById('installHelp');
let installPrompt = null;

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  installButton.textContent = 'App installed';
  installButton.disabled = true;
  installHelp.textContent = 'Linked Up is installed on this device.';
});

installButton.addEventListener('click', async () => {
  if (installPrompt) {
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    installHelp.textContent = choice.outcome === 'accepted'
      ? 'Linked Up is being installed on this device.'
      : 'To install later, use your browser menu and choose Install app or Add to Home screen.';
    installPrompt = null;
    return;
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  installHelp.textContent = isIOS
    ? 'To install on iPhone or iPad, tap Share in Safari, then choose Add to Home Screen.'
    : 'To install, open your browser menu and choose Install app or Add to Home screen.';
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(error => {
      console.error('Could not register the app service worker:', error);
    });
  });
}
