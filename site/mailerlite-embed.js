      if (window.PROOFMETA_MAILERLITE && window.PROOFMETA_MAILERLITE.enabled) {
        (function (w, d, e, u, f, l, n) {
          w[f] = w[f] || function () { (w[f].q = w[f].q || []).push(arguments); };
          l = d.createElement(e); l.async = 1; l.src = u;
          n = d.getElementsByTagName(e)[0]; n.parentNode.insertBefore(l, n);
        })(window, document, 'script', 'https://assets.mailerlite.com/js/universal.js', 'ml');
        ml('account', (window.PROOFMETA_MAILERLITE && window.PROOFMETA_MAILERLITE.accountId) || '2287781');
        ml('forms', (window.PROOFMETA_MAILERLITE && window.PROOFMETA_MAILERLITE.formId) || '185530176070747374');
      }
      (function () {
        var cfg = window.PROOFMETA_MAILERLITE || {};
        var wrap = document.getElementById('builder-thread-embed');
        if (!cfg.enabled || !wrap) return;
        wrap.hidden = false;
        var FORM_ID = cfg.formId || '185530176070747374';
        var status = document.getElementById('builder-thread-status');
        var successMessage = '✓ You\'re on the thread. Check your inbox — confirm the email and you\'re set.';

        function showStatus(message, type) {
          if (!status) return;
          status.textContent = message;
          status.hidden = false;
          status.className = 'builder-thread-status is-' + type;
        }

        window.addEventListener('message', function (event) {
          if (!event.data || typeof event.data !== 'string') return;
          if (event.data.indexOf('mlWebformSubmitSuccess-' + FORM_ID) === 0) {
            if (wrap) wrap.classList.remove('ml-form-loading');
            showStatus(successMessage, 'success');
          }
        });

        var observer = new MutationObserver(function () {
          if (!wrap) return;
          wrap.classList.remove('ml-form-loading');
          var email = wrap.querySelector('input[type="email"]');
          if (email && !email.getAttribute('placeholder')) {
            email.setAttribute('placeholder', 'you@domain.com');
          }
          var submit = wrap.querySelector('button[type="submit"], .ml-form-embedSubmit, .ml-button');
          if (submit && submit.textContent.trim().length < 3) {
            submit.textContent = 'Join the builder thread →';
          }
        });
        var container = document.getElementById('mlb2-' + FORM_ID);
        if (container) {
          observer.observe(container, { childList: true, subtree: true });
        }

        window.setTimeout(function () {
          if (!wrap || wrap.querySelector('input[type="email"]')) return;
          wrap.classList.remove('ml-form-loading');
          showStatus('Signup form failed to load — check MailerLite form settings.', 'error');
        }, 10000);
      })();
