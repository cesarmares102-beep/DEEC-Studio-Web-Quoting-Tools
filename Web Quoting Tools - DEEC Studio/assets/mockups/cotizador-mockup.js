/* Below its natural 1440px width, the dashboard is scaled down as a
   whole (zoomed out) rather than restructured into a simplified mobile
   layout, so it always keeps the full desktop proportions, contained
   to fit. transform:scale() doesn't affect layout flow, so the wrap's
   height is set explicitly to the post-scale rendered height. */
function fitDesktopApp(){
  var wrap = document.querySelector('.app-scale-wrap');
  var app = document.querySelector('.app.desktop-view');
  if (!wrap || !app) return;
  var scale = Math.min(1, wrap.clientWidth / 1440);
  app.style.transform = scale < 1 ? 'scale(' + scale + ')' : 'none';
  wrap.style.height = app.getBoundingClientRect().height + 'px';
}

/* Reports this document's height to the parent page so the embedding
   iframe can resize to fit its content. */
function postMockupHeight(){
  try{
    parent.postMessage({ type:'cotizador-mockup-height', height: document.body.scrollHeight }, '*');
  }catch(e){}
}

function fitAndReport(){
  fitDesktopApp();
  postMockupHeight();
}
fitAndReport();
window.addEventListener('load', fitAndReport);
window.addEventListener('resize', fitAndReport);
