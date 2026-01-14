// import "@stephane888/wbu-atomique/js/bootstrap/all.js";
import "@stephane888/wbu-atomique/js/bootstrap/min.js";
import "@stephane888/wbu-atomique/js/bootstrap/tab.js";
import "@stephane888/wbu-atomique/js/bootstrap/modal.js";
//
// import "@stephane888/wbu-atomique/js/test/try_code.js";
//
// import Tawk
// var Tawk_API=Tawk_API||{}, Tawk_LoadStart=new Date();
// (function(){
// var s1=document.createElement("script"),s0=document.getElementsByTagName("script")[0];
// s1.async=true;
// s1.src='https://embed.tawk.to/65522f9e958be55aeaaf2c7e/1hf4gk20g';
// s1.charset='UTF-8';
// s1.setAttribute('crossorigin','*');
// s0.parentNode.insertBefore(s1,s0);
// })();
// Google tag (gtag.js) event - delayed navigation helper
(function(){
  // Helper function to delay opening a URL until a gtag event is sent.
  // Call it in response to an action that should navigate to a URL.
  function gtagSendEvent(url) {
    var callback = function () {
      if (typeof url === 'string') {
        window.location = url;
      }
    };
    gtag('event', 'conversion_event_request_quote', {
      'event_callback': callback,
      'event_timeout': 2000,
      // <event_parameters>
    });
    return false;
  }
})();
      // On recupere le fichier scss generer precedament.
      import "../scss/drush_site_install--vendor.scss";
    