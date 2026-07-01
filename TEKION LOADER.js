// ==UserScript==
// @name         Tekion RO Fulfillment Opener
// @namespace    reconclipboard
// @version      1.1
// @description  Auto-drives Tekion's Parts RO Sales -> Create Fulfillment flow when opened from ReconVision with #rv_ro=<RO#>
// @updateURL    https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/TEKION%20LOADER.js
// @downloadURL  https://raw.githubusercontent.com/GMWalser/WALSER-RECON-SCRIPTS/refs/heads/main/TEKION%20LOADER.js
// @match        https://app.tekioncloud.com/parts/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  function getRoFromHash() {
    const m = location.hash.match(/rv_ro=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value') &&
                    Object.getOwnPropertyDescriptor(proto, 'value').set;
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: value.slice(-1) }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: value.slice(-1) }));
  }

  function run(roNumber) {
    let stage = 'waitForCreateFulfillment';
    let attempts = 0;
    const maxAttempts = 80;

    const tick = setInterval(() => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(tick);
        console.warn('[Tekion RO Opener] Timed out at stage: ' + stage);
        return;
      }

      if (stage === 'waitForCreateFulfillment') {
        const createBtn = document.querySelector(
          '[data-test-id="@tekion-parts-partsRoSales-common-createGroupedPartRequestsModalButton"]'
        );
        if (createBtn) {
          createBtn.click();
          stage = 'waitForRoInput';
        }
        return;
      }

      if (stage === 'waitForRoInput') {
        const roInput = document.querySelector(
          '[data-test-id^="@tekion-parts-partsRoSales-common-createGroupedPartRequestsSelect"] input.ant-select-search__field, ' +
          'input.ant-select-search__field'
        );
        if (roInput) {
          roInput.focus();
          setNativeValue(roInput, roNumber);
          stage = 'waitForDropdownOption';
        }
        return;
      }

      if (stage === 'waitForDropdownOption') {
        const options = document.querySelectorAll(
          '.ant-select-item-option, .ant-select-dropdown li, [role="option"]'
        );
        let match = null;
        options.forEach(opt => {
          if (!match && opt.textContent && opt.textContent.includes(roNumber)) {
            match = opt;
          }
        });
        if (match) {
          match.click();
          stage = 'waitForSubmit';
        }
        return;
      }

      if (stage === 'waitForSubmit') {
        const submitBtn = document.querySelector(
          '[data-test-id="@tekion-parts-roSalesDetailedView-createGroupedPartRequestsModal-container-submitButton"]'
        );
        if (submitBtn && !submitBtn.disabled) {
          clearInterval(tick);
          submitBtn.click();
        }
        return;
      }
    }, 250);
  }

  const roNumber = getRoFromHash();
  if (roNumber) {
    setTimeout(() => run(roNumber), 1500);
  }

  window.addEventListener('hashchange', () => {
    const ro = getRoFromHash();
    if (ro) run(ro);
  });

})();
