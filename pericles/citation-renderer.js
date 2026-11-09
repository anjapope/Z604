'use strict';

(function initializeCitationRenderer(root) {
  function safeHttpUrl(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
        ? value
        : null;
    } catch (_error) {
      return null;
    }
  }

  function appendLinkedText(container, text, documentRef) {
    const urlPattern = /\[([^\]\n]+)\]\((\/catalog-detail\.html\?id=CAT-\d+|\/community-support\.html#[a-z-]+|https?:\/\/[^\s<>"')]+)\)|https?:\/\/[^\s<>"']+/gi;
    let currentIndex = 0;
    let match;

    while ((match = urlPattern.exec(text)) !== null) {
      if (match[2]) {
        container.appendChild(documentRef.createTextNode(text.slice(currentIndex, match.index)));
        const link = documentRef.createElement('a');
        const external = /^https?:/i.test(match[2]);
        const href = external ? safeHttpUrl(match[2]) : root.PericlesApi?.catalogUrl ? root.PericlesApi.catalogUrl(match[2]) : match[2];
        if (!href) { container.appendChild(documentRef.createTextNode(match[1])); currentIndex = match.index + match[0].length; continue; }
        link.href = href;
        if (external) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
        link.textContent = match[1];
        container.appendChild(link);
        currentIndex = match.index + match[0].length;
        continue;
      }
      let candidateUrl = match[0];
      let trailingPunctuation = '';
      while (/[),.;!?]$/.test(candidateUrl)) {
        trailingPunctuation = candidateUrl.slice(-1) + trailingPunctuation;
        candidateUrl = candidateUrl.slice(0, -1);
      }

      container.appendChild(documentRef.createTextNode(text.slice(currentIndex, match.index)));
      const href = safeHttpUrl(candidateUrl);
      if (href) {
        const link = documentRef.createElement('a');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = candidateUrl;
        container.appendChild(link);
      } else {
        container.appendChild(documentRef.createTextNode(candidateUrl));
      }
      container.appendChild(documentRef.createTextNode(trailingPunctuation));
      currentIndex = match.index + match[0].length;
    }
    container.appendChild(documentRef.createTextNode(text.slice(currentIndex)));
  }

  function renderMessageContent(container, text, sources = [], documentRef = root.document) {
    container.replaceChildren();
    appendLinkedText(container, String(text || ''), documentRef);
    if (!Array.isArray(sources) || sources.length === 0) return;

    const section = documentRef.createElement('section');
    section.className = 'message-sources';
    const heading = documentRef.createElement('strong');
    heading.textContent = 'Sources';
    section.appendChild(heading);
    const list = documentRef.createElement('ul');

    for (const source of sources) {
      const href = safeHttpUrl(source?.url);
      if (!href) continue;

      const item = documentRef.createElement('li');
      if (source.category) {
        const category = documentRef.createElement('strong');
        category.className = `source-category source-category-${source.category}`;
        category.textContent = source.category === 'direct' ? 'Directly relevant: ' : 'Supplementary: ';
        item.appendChild(category);
      }
      const link = documentRef.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = source.title || source.url;
      item.appendChild(link);
      const attribution = [source.author, source.institution].filter((value) =>
        typeof value === 'string' && value.trim()
      ).join('; ');
      if (attribution) {
        item.appendChild(documentRef.createTextNode(` (${attribution})`));
      }
      if (source.sourceType) {
        item.appendChild(documentRef.createTextNode(` (Source type: ${source.sourceType})`));
      }
      if (typeof source.relevance === 'string' && source.relevance.trim()) {
        const explanation = documentRef.createElement('p');
        explanation.className = 'source-relevance';
        explanation.textContent = source.relevance;
        item.appendChild(explanation);
      }
      list.appendChild(item);
    }

    if (list.childNodes.length) {
      section.appendChild(list);
      container.appendChild(section);
    }
  }

  root.PericlesCitationRenderer = { renderMessageContent, safeHttpUrl };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderMessageContent, safeHttpUrl };
  }
}(typeof window === 'undefined' ? globalThis : window));
