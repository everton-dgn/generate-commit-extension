/* global acquireVsCodeApi */
(() => {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  let state = null;

  // Last interaction modality: the switch focus ring only appears on
  // keyboard navigation (in Chromium, checkboxes match :focus-visible even
  // on mouse clicks).
  document.addEventListener(
    'pointerdown',
    () => document.body.setAttribute('data-modality', 'pointer'),
    true,
  );
  document.addEventListener(
    'keydown',
    () => document.body.setAttribute('data-modality', 'keyboard'),
    true,
  );

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'state') {
      state = message.state;
      render();
    } else if (message.type === 'keyResult') {
      showKeyResult(message.provider, message.ok, message.reason, message.allowForce);
    } else if (message.type === 'updateResult') {
      showUpdateResult(message.key, message.ok, message.reason);
    }
  });

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function sendUpdate(key, value) {
    vscode.postMessage({ type: 'update', key, value });
  }

  function field(labelText, control, hintText) {
    const wrap = el('div', 'field');
    const label = el('label', '', labelText);
    // The label cannot use htmlFor (the control has no stable id), so
    // clicking it focuses the field's first control, even inside the
    // .select-wrap.
    label.addEventListener('click', () => {
      const target = wrap.querySelector('.control, input, select');
      if (target) target.focus();
    });
    wrap.append(label);
    wrap.append(control);
    if (hintText) wrap.append(el('p', 'hint', hintText));
    return wrap;
  }

  const pendingKeys = {};

  function textInput(key, value, placeholder, type) {
    const input = el('input', 'control');
    input.type = type || 'text';
    input.value = value || '';
    input.placeholder = placeholder || 'provider default';
    input.dataset.key = key;
    input.spellcheck = false;
    let timer = null;
    input.addEventListener('input', () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => sendUpdate(key, input.value), 350);
    });
    input.addEventListener('change', () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      sendUpdate(key, input.value);
    });
    return input;
  }

  function numberInput(key, value, min) {
    const input = textInput(key, String(value), '', 'number');
    input.min = String(min);
    return input;
  }

  // Multiline textarea with the same debounce as textInput; vertically
  // resizable via CSS.
  function textareaInput(key, value, placeholder, rows) {
    const input = el('textarea', 'control');
    input.value = value || '';
    input.placeholder = placeholder || '';
    input.rows = rows || 3;
    input.dataset.key = key;
    input.spellcheck = false;
    let timer = null;
    input.addEventListener('input', () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => sendUpdate(key, input.value), 350);
    });
    input.addEventListener('change', () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      sendUpdate(key, input.value);
    });
    return input;
  }

  // Custom inline SVG arrow created via DOM: the CSP blocks images
  // (img-src 'none'), so background-image/data URI would not work.
  function selectArrow() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'select-arrow');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M4 6l4 4 4-4');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    return svg;
  }

  function wrapSelect(select) {
    const wrap = el('span', 'select-wrap');
    wrap.append(select, selectArrow());
    return wrap;
  }

  function selectInput(key, value, options) {
    const select = el('select', 'control');
    select.dataset.key = key;
    for (const [optionValue, optionLabel] of options) {
      const option = el('option', '', optionLabel);
      option.value = optionValue;
      if (optionValue === value) option.selected = true;
      select.append(option);
    }
    select.addEventListener('change', () => sendUpdate(key, select.value));
    return wrapSelect(select);
  }

  function checkboxInput(key, value, labelText) {
    const wrap = el('label', 'checkbox-row');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = Boolean(value);
    input.dataset.key = key;
    input.addEventListener('change', () => sendUpdate(key, input.checked));
    wrap.append(input, document.createTextNode(labelText));
    return wrap;
  }

  function providerOptionLabel(provider) {
    if (provider.available) return provider.label;
    return `${provider.label} (${provider.kind === 'cli' ? 'CLI not found' : 'no key'})`;
  }

  function providerById(id) {
    return state.providers.find((p) => p.id === id);
  }

  function modelDatalist(input, models, idSuffix) {
    if (!models || models.length === 0) return null;
    const listId = `gc-models-${idSuffix}`;
    input.setAttribute('list', listId);
    const datalist = el('datalist');
    datalist.id = listId;
    for (const model of models) {
      const option = el('option');
      option.value = model;
      datalist.append(option);
    }
    return datalist;
  }

  // Free-text mode is keyed by the CONFIG key: each setting toggles between
  // select and input independently and consistently.
  const customMode = {};

  // fkey of the free-text field that must receive focus after the re-render
  // that swaps the select for the input (choosing "Custom…").
  let pendingFocus = null;

  function modelControl(provider, key, idSuffix, fkey) {
    const hasCatalog = provider.models.length > 0;
    if (!hasCatalog || customMode[key]) {
      const input = textInput(key, provider.model);
      if (fkey) input.dataset.fkey = fkey;
      const wrap = el('span', 'model-control');
      wrap.append(input);
      if (hasCatalog) {
        const datalist = modelDatalist(input, provider.models, idSuffix);
        if (datalist) wrap.append(datalist);
        const back = el('button', 'link-btn', 'Choose from list');
        back.type = 'button';
        back.title = 'Show the model list';
        back.addEventListener('click', () => {
          delete customMode[key];
          render();
        });
        wrap.append(back);
      }
      return wrap;
    }
    const select = el('select', 'control');
    select.dataset.key = key;
    if (fkey) select.dataset.fkey = fkey;
    for (const option of provider.modelOptions) {
      const opt = el('option', '', option.label);
      opt.value = option.value;
      if (option.value === provider.modelSelected) opt.selected = true;
      select.append(opt);
    }
    select.addEventListener('change', () => {
      if (select.value === state.customModelValue) {
        customMode[key] = true;
        // Blur before re-rendering: otherwise focus restoration would insert
        // the sentinel value into the new free-text input. pendingFocus gives
        // focus back to the input after the render.
        pendingFocus = select.dataset.fkey || null;
        select.blur();
        render();
        return;
      }
      sendUpdate(key, select.value);
    });
    return wrapSelect(select);
  }

  function renderProviderSection() {
    const section = el('section');
    section.append(el('h2', '', 'Provider'));
    const options = state.providers.map((p) => [p.id, providerOptionLabel(p)]);
    section.append(field('Active provider', selectInput('provider', state.provider, options)));
    const active = providerById(state.provider);
    if (active) {
      const control = modelControl(active, `${active.id}.model`, 'main', `main:${active.id}.model`);
      section.append(field('Model', control, active.availabilityNote));
      if (active.kind === 'cli') {
        const effortOptions = active.effortOptions.map((o) => [o.value, o.label]);
        // A saved value outside the selected model's list shows up as
        // "(current)"; the hint makes clear it may be incompatible.
        const currentOpt = active.effortOptions.find((o) => o.value === active.effortSelected);
        const unsupported =
          active.effortSelected !== '' && currentOpt && currentOpt.label.endsWith('(current)');
        const effortField = field(
          'Effort',
          selectInput(`${active.id}.effort`, active.effortSelected, effortOptions),
          state.disableThinking
            ? 'ignored while thinking is disabled'
            : unsupported
              ? 'not supported by the selected model'
              : undefined,
        );
        if (state.disableThinking) {
          const select = effortField.querySelector('select');
          if (select) select.disabled = true;
        }
        section.append(effortField);
      } else {
        section.append(
          field('Base URL (HTTPS only)', textInput(`${active.id}.baseUrl`, active.baseUrl)),
        );
        if (active.id === 'anthropicCustom') {
          section.append(
            field(
              'Auth header style',
              selectInput(`${active.id}.authHeader`, active.authHeader, [
                ['x-api-key', 'x-api-key'],
                ['bearer', 'bearer'],
              ]),
            ),
          );
        }
      }
    }
    return section;
  }

  // The language free-text mode shares the model's customMode map: both are
  // keyed by the config key.
  function languageControl() {
    const key = 'language';
    if (customMode[key]) {
      const input = textInput(key, state.language, 'en, pt-BR, ...');
      input.dataset.fkey = 'main:language';
      const wrap = el('span', 'model-control');
      wrap.append(input);
      const back = el('button', 'link-btn', 'Choose from list');
      back.type = 'button';
      back.title = 'Show the language list';
      back.addEventListener('click', () => {
        delete customMode[key];
        render();
      });
      wrap.append(back);
      return wrap;
    }
    const select = el('select', 'control');
    select.dataset.key = key;
    select.dataset.fkey = 'main:language';
    const known = state.languages.some((l) => l.code === state.language);
    if (state.language && !known) {
      const opt = el('option', '', `${state.language} (current)`);
      opt.value = state.language;
      opt.selected = true;
      select.append(opt);
    }
    for (const lang of state.languages) {
      const opt = el('option', '', `${lang.label} (${lang.code})`);
      opt.value = lang.code;
      if (lang.code === state.language) opt.selected = true;
      select.append(opt);
    }
    const custom = el('option', '', 'Custom…');
    custom.value = state.customModelValue;
    select.append(custom);
    select.addEventListener('change', () => {
      if (select.value === state.customModelValue) {
        customMode[key] = true;
        // Blur before re-rendering: otherwise focus restoration would insert
        // the sentinel value into the new free-text input. pendingFocus gives
        // focus back to the input after the render.
        pendingFocus = select.dataset.fkey || null;
        select.blur();
        render();
        return;
      }
      sendUpdate(key, select.value);
    });
    return wrapSelect(select);
  }

  function renderBehaviorSection() {
    const section = el('section');
    section.append(el('h2', '', 'Behavior'));

    section.append(
      field('Message language', languageControl(), 'Conventional Commits in this language'),
    );

    section.append(
      field(
        'When no staged changes',
        selectInput('unstagedFallback', state.unstagedFallback, [
          ['ask', 'ask'],
          ['always', 'always'],
          ['never', 'never'],
        ]),
      ),
    );
    section.append(
      checkboxInput(
        'includeRecentCommits',
        state.includeRecentCommits,
        'Include 10 recent commit subjects as style context',
      ),
    );
    section.append(
      checkboxInput(
        'disableThinking',
        state.disableThinking,
        'Disable thinking on CLI providers (faster, less reasoning)',
      ),
    );
    section.append(
      field(
        'Custom prompt instructions',
        textareaInput('customPrompt', state.customPrompt, 'empty', 3),
        'Appended to the system prompt',
      ),
    );
    return section;
  }

  function renderLimitsSection() {
    const section = el('section');
    section.append(el('h2', '', 'Limits'));
    section.append(
      field('Max diff characters', numberInput('maxDiffChars', state.maxDiffChars, 1000)),
    );
    section.append(
      field('Max file size (KB)', numberInput('maxFileSizeKB', state.maxFileSizeKB, 1)),
    );
    section.append(
      field('Timeout (seconds)', numberInput('timeoutSeconds', state.timeoutSeconds, 5)),
    );
    return section;
  }

  function renderKeysSection() {
    const section = el('section');
    section.append(el('h2', '', 'API keys'));
    const keyBacked = state.providers.filter((p) => p.kind === 'http');
    for (const provider of keyBacked) {
      const row = el('div', 'key-row');
      const statusClass = provider.hasKey ? 'status-ok' : 'status-missing';
      const statusText = provider.hasKey ? 'configured' : 'not set';
      const head = el('div', 'key-head');
      head.append(el('span', 'key-label', provider.label));
      head.append(el('span', `key-status ${statusClass}`, statusText));
      head.dataset.providerStatus = provider.id;
      row.append(head);
      const controls = el('div', 'key-controls');
      const input = el('input', 'control');
      input.type = 'password';
      input.placeholder = provider.hasKey ? 'replace key' : 'paste key';
      input.autocomplete = 'off';
      input.spellcheck = false;
      const button = el('button', '', 'Save');
      button.addEventListener('click', () => {
        const status = row.querySelector('.key-status');
        if (status) status.textContent = 'validating...';
        pendingKeys[provider.id] = input.value;
        vscode.postMessage({ type: 'saveKey', provider: provider.id, value: input.value });
        input.value = '';
      });
      controls.append(input, button);
      row.append(controls);
      section.append(row);
    }
    return section;
  }

  function render() {
    if (!state || !app) return;
    const focused = document.activeElement;
    const focusedKey = focused?.dataset ? focused.dataset.fkey || focused.dataset.key : null;
    const focusedValue = focusedKey ? focused.value : null;
    const focusedSel =
      focusedKey && typeof focused.selectionStart === 'number'
        ? [focused.selectionStart, focused.selectionEnd]
        : null;
    app.textContent = '';
    app.append(
      renderProviderSection(),
      renderBehaviorSection(),
      renderLimitsSection(),
      renderKeysSection(),
    );
    if (focusedKey) {
      const again =
        app.querySelector(`[data-fkey="${CSS.escape(focusedKey)}"]`) ??
        app.querySelector(`[data-key="${CSS.escape(focusedKey)}"]`);
      if (again) {
        again.focus();
        // On <select> only focus is restored, never the value: the recreated
        // select already carries the correct selection from state, and
        // reassigning a value captured before the re-render could display an
        // option the new state no longer has (e.g. the previous model's effort).
        if (again.tagName !== 'SELECT' && focusedValue !== null && 'value' in again) {
          again.value = focusedValue;
          if (focusedSel && again.setSelectionRange) {
            again.setSelectionRange(focusedSel[0], focusedSel[1]);
          }
        }
      }
    }
    if (pendingFocus) {
      const target = app.querySelector(`[data-fkey="${CSS.escape(pendingFocus)}"]`);
      pendingFocus = null;
      if (target) target.focus();
    }
  }

  function showKeyResult(provider, ok, reason, allowForce) {
    if (!app) return;
    const status = app.querySelector(`[data-provider-status="${provider}"] .key-status`);
    if (!status) return;
    if (ok) {
      delete pendingKeys[provider];
      status.textContent = reason ? `configured (${reason})` : 'configured';
      status.className = 'key-status status-ok';
      return;
    }
    status.textContent = `invalid: ${reason}`;
    status.className = 'key-status status-missing';
    if (allowForce && pendingKeys[provider]) {
      const forceBtn = el('button', 'force-save', 'Save anyway');
      forceBtn.addEventListener('click', () => {
        status.textContent = 'saving...';
        vscode.postMessage({
          type: 'saveKey',
          provider,
          value: pendingKeys[provider],
          force: true,
        });
      });
      status.append(document.createTextNode(' '), forceBtn);
    }
  }

  function stateValueFor(key) {
    if (!state) return '';
    if (Object.hasOwn(state, key)) return state[key];
    const dot = key.indexOf('.');
    if (dot > 0) {
      const provider = providerById(key.slice(0, dot));
      if (provider) {
        const field = key.slice(dot + 1);
        if (field === 'model') return provider.model;
        if (field === 'baseUrl') return provider.baseUrl;
        if (field === 'authHeader') return provider.authHeader;
        if (field === 'effort') return provider.effort;
      }
    }
    return '';
  }

  let statusTimer = null;

  function showStatus(text) {
    let bar = document.getElementById('gc-status');
    if (!bar) {
      bar = el('div', 'status-line');
      bar.id = 'gc-status';
      document.body.insertBefore(bar, app);
    }
    bar.textContent = text;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      bar.textContent = '';
    }, 2500);
  }

  function showUpdateResult(key, ok, reason) {
    if (ok || !app) return;
    const input = app.querySelector(`[data-key="${key}"]`);
    if (input && 'value' in input) {
      // On checkboxes the visual state is checked, not value.
      if (input.type === 'checkbox') {
        input.checked = stateValueFor(key) === true;
      } else {
        input.value = stateValueFor(key);
      }
      input.classList.add('invalid-flash');
      setTimeout(() => input.classList.remove('invalid-flash'), 2000);
    }
    showStatus(`Not applied: ${reason}`);
  }

  vscode.postMessage({ type: 'ready' });
})();
