(() => {
  const base = document.body.dataset.base || '';
  const toast = document.querySelector('#toast');
  let toastTimer;
  function notify(message) {
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
  }
  const themeButton = document.querySelector('#theme-toggle');
  function themeLabel() {
    themeButton.setAttribute(
      'aria-label',
      document.documentElement.dataset.theme === 'dark' ? '切换浅色主题' : '切换深色主题',
    );
  }
  themeLabel();
  themeButton.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('jingchuanchu-docs-theme', theme);
    } catch {}
    themeLabel();
  });
  document.querySelector('.sidebar a[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
  document.querySelectorAll('article pre').forEach((pre) => {
    if (pre.closest('.code-block')) return;
    const block = document.createElement('div');
    block.className = 'code-block';
    const label = document.createElement('div');
    label.className = 'code-label';
    label.textContent = 'CODE';
    pre.before(block);
    block.append(label, pre);
  });
  document.querySelectorAll('.code-block').forEach((block) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-button';
    button.textContent = '复制';
    button.setAttribute('aria-label', '复制此段代码');
    button.addEventListener('click', async () => {
      const text = block.querySelector('pre code').textContent;
      try {
        if (navigator.clipboard && window.isSecureContext)
          await navigator.clipboard.writeText(text);
        else {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.cssText = 'position:fixed;left:-10000px;top:0';
          document.body.append(textarea);
          textarea.select();
          const success = document.execCommand('copy');
          textarea.remove();
          if (!success) throw new Error('copy unavailable');
          button.focus();
        }
        notify('代码已复制');
      } catch {
        notify('复制受限，请选中代码手动复制');
      }
    });
    block.append(button);
  });
  const apiFilter = document.querySelector('#api-filter');
  if (apiFilter) {
    function filterApi() {
      const query = apiFilter.value.trim().toLocaleLowerCase();
      let total = 0;
      document.querySelectorAll('[data-api-category]').forEach((category) => {
        let matches = 0;
        category.querySelectorAll('[data-api-item]').forEach((item) => {
          const match = (category.querySelector('header').textContent + ' ' + item.textContent)
            .toLocaleLowerCase()
            .includes(query);
          item.hidden = !match;
          if (match) matches++;
        });
        category
          .querySelectorAll('.api-subgroup')
          .forEach(
            (subgroup) =>
              (subgroup.hidden = !subgroup.querySelector('[data-api-item]:not([hidden])')),
          );
        category.hidden = matches === 0;
        total += matches;
      });
      document.querySelector('#api-count').textContent = `${total} 项 API`;
      document.querySelector('#api-empty').hidden = total > 0;
    }
    apiFilter.addEventListener('input', filterApi);
    filterApi();
  }
  const outlineLinks = [...document.querySelectorAll('.outline nav a')];
  if (outlineLinks.length && 'IntersectionObserver' in window) {
    const headings = outlineLinks
      .map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))))
      .filter(Boolean);
    const observer = new IntersectionObserver(
      () => {
        let current = headings[0];
        for (const heading of headings)
          if (heading.getBoundingClientRect().top <= 150) current = heading;
        outlineLinks.forEach((link) =>
          link.classList.toggle('active', decodeURIComponent(link.hash.slice(1)) === current.id),
        );
      },
      { rootMargin: '-90px 0px -65% 0px', threshold: [0, 1] },
    );
    headings.forEach((heading) => observer.observe(heading));
  }
  const dialog = document.querySelector('#search-dialog');
  const input = document.querySelector('#doc-search');
  const resultBox = document.querySelector('#search-results');
  let active = 0;
  let previousFocus;
  function select(index) {
    const links = [...resultBox.querySelectorAll('.search-result')];
    if (!links.length) return;
    active = (index + links.length) % links.length;
    links.forEach((link, i) => {
      link.classList.toggle('active', i === active);
      link.setAttribute('aria-current', i === active ? 'true' : 'false');
    });
    links[active].scrollIntoView({ block: 'nearest' });
  }
  function renderSearch() {
    resultBox.replaceChildren();
    const query = input.value.trim().toLocaleLowerCase();
    const index = window.DOC_SEARCH_INDEX || [];
    const tokens = query.split(/\s+/).filter(Boolean);
    let results;
    if (!query)
      results = index.filter((item) =>
        [
          'guide/quick-start.html',
          'guide/components.html',
          'api/index.html',
          'engineering/project-structure.html',
          'engineering/cli.html',
        ].includes(item.url),
      );
    else
      results = index
        .map((item) => {
          const title = item.title.toLocaleLowerCase();
          const haystack =
            `${title} ${item.section} ${item.description} ${item.text}`.toLocaleLowerCase();
          const score = tokens.every((token) => haystack.includes(token))
            ? title === query
              ? 100
              : title.includes(query)
                ? 70
                : tokens.every((token) => title.includes(token))
                  ? 50
                  : 10
            : 0;
          return { item, score };
        })
        .filter((row) => row.score)
        .sort((a, b) => b.score - a.score)
        .slice(0, 25)
        .map((row) => row.item);
    if (!results.length) {
      const empty = document.createElement('p');
      empty.textContent = '没有找到相关内容，试试 API 名称或其他关键词。';
      resultBox.append(empty);
    }
    for (const item of results) {
      const link = document.createElement('a');
      link.className = 'search-result';
      link.href = base + item.url;
      const section = document.createElement('small');
      section.textContent = item.section;
      const title = document.createElement('strong');
      title.textContent = item.title;
      const description = document.createElement('p');
      description.textContent = item.description;
      link.append(section, title, description);
      resultBox.append(link);
      link.addEventListener('click', () => dialog.close());
    }
    active = 0;
    select(0);
  }
  function openSearch() {
    if (dialog.open) return;
    previousFocus = document.activeElement;
    dialog.showModal();
    renderSearch();
    input.focus();
  }
  document
    .querySelectorAll('[data-open-search]')
    .forEach((button) => button.addEventListener('click', openSearch));
  input.addEventListener('input', renderSearch);
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
      event.preventDefault();
      openSearch();
    }
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      select(active + (event.key === 'ArrowDown' ? 1 : -1));
    }
    if (event.key === 'Enter' && event.target === input) {
      event.preventDefault();
      resultBox.querySelectorAll('.search-result')[active]?.click();
    }
  });
  dialog.addEventListener('close', () => previousFocus?.focus());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dialog.close();
    }
  });
})();
