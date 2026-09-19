/* Launch-offer auto-switch.
   Free launch window ends 31 Oct 2026 (last free day); price becomes
   $1.99 one-time on 1 Nov 2026 09:00 SGT (= 01:00 UTC, same moment the
   App Store Connect price change is made). Any element with data-paid
   swaps its content for that value from then on. */
(function(){
  var PAID_AT = Date.UTC(2026, 10, 1, 1, 0, 0);
  if (Date.now() < PAID_AT) return;
  document.querySelectorAll('[data-paid]').forEach(function(el){
    el.innerHTML = el.getAttribute('data-paid');
  });
})();
