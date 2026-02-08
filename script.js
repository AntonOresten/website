(function () {
  var toc = document.querySelector('.toc');
  var tocToggle = document.querySelector('.toc .toc-toggle');
  var tocPanel = toc ? toc.querySelector('.toc-panel') : null;
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc a[href^="#"]'));
  var chapterLinks = Array.prototype.slice.call(document.querySelectorAll('.toc .toc-list > li > a[href^="#"]'));
  var chapterItems = Array.prototype.slice.call(document.querySelectorAll('.toc .toc-list > li'));
  var tocOpenTimer = 0;
  if (!tocLinks.length) {
    return;
  }

  var sections = tocLinks
    .map(function (link) {
      var id = link.getAttribute('href').slice(1);
      return document.getElementById(id);
    })
    .filter(Boolean);

  if (!sections.length) {
    return;
  }

  function chapterLinkForSection(section) {
    if (!section) return null;

    var chapterSection =
      section.classList && section.classList.contains('chapter') ? section : section.closest('.chapter');
    if (!chapterSection || !chapterSection.id) return null;

    var chapterHref = '#' + chapterSection.id;
    for (var i = 0; i < chapterLinks.length; i += 1) {
      if (chapterLinks[i].getAttribute('href') === chapterHref) {
        return chapterLinks[i];
      }
    }
    return null;
  }

  function setCurrentChapter(link) {
    if (!chapterItems.length) return;

    var currentItem = link ? link.closest('.toc .toc-list > li') : null;
    chapterItems.forEach(function (item) {
      item.classList.toggle('toc-current', item === currentItem);
    });
  }

  function setActiveChapter(link) {
    chapterLinks.forEach(function (chapterLink) {
      chapterLink.classList.toggle('active', chapterLink === link);
    });
    setCurrentChapter(link);
  }

  function updateTocScrollHints() {
    if (!toc || !tocPanel) return;

    var maxScroll = Math.max(0, tocPanel.scrollHeight - tocPanel.clientHeight);
    var canScroll = maxScroll > 2;
    var atTop = !canScroll || tocPanel.scrollTop <= 1;
    var atBottom = !canScroll || tocPanel.scrollTop >= maxScroll - 1;

    toc.classList.toggle('toc-can-scroll', canScroll);
    toc.classList.toggle('toc-at-top', atTop);
    toc.classList.toggle('toc-at-bottom', atBottom);
  }

  function clearOpenTimer() {
    if (!tocOpenTimer) return;
    window.clearTimeout(tocOpenTimer);
    tocOpenTimer = 0;
  }

  function setTocOpen(open) {
    if (!toc || !tocToggle) return;
    toc.classList.toggle('open', open);
    tocToggle.setAttribute('aria-expanded', String(open));
    clearOpenTimer();

    if (open) {
      toc.classList.add('opening');
      toc.classList.remove('scroll-ready');
      tocOpenTimer = window.setTimeout(function () {
        tocOpenTimer = 0;
        if (!toc.classList.contains('open')) return;
        toc.classList.remove('opening');
        toc.classList.add('scroll-ready');
        updateTocScrollHints();
      }, 240);
    } else {
      toc.classList.remove('opening');
      toc.classList.remove('scroll-ready');
    }

    updateTocScrollHints();
  }

  if (tocToggle) {
    tocToggle.addEventListener('click', function (event) {
      event.stopPropagation();
      setTocOpen(!toc.classList.contains('open'));
    });
  }

  if (tocPanel) {
    tocPanel.addEventListener('scroll', updateTocScrollHints, { passive: true });
    tocPanel.addEventListener(
      'wheel',
      function (event) {
        if (!toc || !toc.classList.contains('open') || !toc.classList.contains('scroll-ready')) return;

        var maxScroll = Math.max(0, tocPanel.scrollHeight - tocPanel.clientHeight);
        if (maxScroll <= 2) {
          event.preventDefault();
          return;
        }

        var atTop = tocPanel.scrollTop <= 1;
        var atBottom = tocPanel.scrollTop >= maxScroll - 1;
        var pushingPastTop = event.deltaY < 0 && atTop;
        var pushingPastBottom = event.deltaY > 0 && atBottom;

        if (pushingPastTop || pushingPastBottom) {
          event.preventDefault();
          tocPanel.scrollTop = pushingPastTop ? 0 : maxScroll;
        }
      },
      { passive: false }
    );
  }

  function scrollToSection(section) {
    var top = Math.max(0, window.pageYOffset + section.getBoundingClientRect().top - 8);
    window.scrollTo({
      top: top,
      behavior: 'smooth',
    });
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function activationLineOffset() {
    var doc = document.documentElement;
    var maxScroll = Math.max(1, doc.scrollHeight - window.innerHeight);
    if (maxScroll < 80) {
      return window.innerHeight * 0.48;
    }
    var progress = clamp(window.pageYOffset / maxScroll, 0, 1);
    // Move the activation line down as we approach the end of the document.
    var eased = 1 - Math.pow(1 - progress, 1.6);
    var ratio = 0.2 + (0.88 - 0.2) * eased;
    return window.innerHeight * ratio;
  }

  function sectionTop(section) {
    return window.pageYOffset + section.getBoundingClientRect().top;
  }

  function activeSectionForViewport() {
    if (!sections.length) return null;

    var line = window.pageYOffset + activationLineOffset();
    var active = sections[0];

    for (var i = 0; i < sections.length; i += 1) {
      if (sectionTop(sections[i]) <= line) {
        active = sections[i];
      } else {
        break;
      }
    }

    return active;
  }

  var scrollRoom = document.createElement('div');
  scrollRoom.setAttribute('aria-hidden', 'true');
  scrollRoom.id = 'toc-scroll-room';

  function ensureScrollRoom() {
    if (!scrollRoom.parentNode) {
      var article = document.querySelector('.essay-content');
      if (!article) return;
      article.appendChild(scrollRoom);
    }

    var doc = document.documentElement;
    var currentOverflow = Math.max(0, doc.scrollHeight - window.innerHeight);
    var existingSpacer = scrollRoom.offsetHeight || 0;
    var baseOverflow = Math.max(0, currentOverflow - existingSpacer);
    var desiredOverflow = Math.floor(window.innerHeight * 0.16);
    var needed = Math.max(0, desiredOverflow - baseOverflow);
    scrollRoom.style.height = needed + 'px';
  }

  function updateActiveChapterFromScroll() {
    setActiveChapter(chapterLinkForSection(activeSectionForViewport()));
  }

  tocLinks.forEach(function (link) {
    link.addEventListener('click', function (event) {
      var href = link.getAttribute('href');
      if (!href || href === '#') return;
      var section = document.getElementById(href.slice(1));
      if (!section) return;

      event.preventDefault();
      setActiveChapter(chapterLinkForSection(section));
      scrollToSection(section);
      history.replaceState(null, '', href);
    });
  });

  var ticking = false;
  function requestUpdate() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      ticking = false;
      ensureScrollRoom();
      updateActiveChapterFromScroll();
      updateTocScrollHints();
    });
  }

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
  window.addEventListener('load', requestUpdate);

  if (toc && toc.classList.contains('open')) {
    toc.classList.add('scroll-ready');
  }

  var hashSection = window.location.hash ? document.getElementById(window.location.hash.slice(1)) : null;
  setActiveChapter(chapterLinkForSection(hashSection) || chapterLinks[0] || null);
  ensureScrollRoom();
  updateActiveChapterFromScroll();
  updateTocScrollHints();
})();
