/* efarblog 前台插件运行时：阅读计数 / 自建评论 / 图片灯箱 / KaTeX / mermaid
 * 由 layout.html 的 window.SITE_PLUGINS 驱动；PJAX 换页后自动重新初始化。 */
(function () {
  'use strict';

  var P = window.SITE_PLUGINS || {};

  function loadScript(src, cb) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = function () { cb && cb(); };
    document.head.appendChild(s);
  }

  /* ---------- 阅读计数 ---------- */

  function initViews() {
    if (!P.views) return;
    var el = document.querySelector('.leancloud_visitors');
    if (!el) return;
    var path = el.id;
    var counter = el.querySelector('.leancloud-visitors-count');
    if (!counter) return;
    var key = 'viewed:' + path;
    if (sessionStorage.getItem(key)) {
      // 本会话已计过数：只读取显示，不再累加
      fetch('/api/view?path=' + encodeURIComponent(path))
        .then(function (r) { return r.json(); })
        .then(function (j) { if (j.ok) counter.textContent = j.count; })
        .catch(function () {});
      return;
    }
    fetch('/api/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path }),
    }).then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.ok) {
          counter.textContent = j.count;
          sessionStorage.setItem(key, '1');
        }
      })
      .catch(function () {});
  }

  /* ---------- 自建评论（无限嵌套） ---------- */

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : s;
    return d.innerHTML;
  }

  var AVATAR_COLORS = ['#e9546b', '#ed6ea0', '#ec8c69', '#38a1db', '#3e999f', '#9d5b8b', '#0a7426', '#eab700'];

  function avatarColor(name) {
    var n = 0;
    for (var i = 0; i < name.length; i++) n = (n * 31 + name.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[n % AVATAR_COLORS.length];
  }

  function commentForm(parentId, onDone) {
    var f = document.createElement('form');
    f.className = 'efc-form';
    f.innerHTML =
      '<div class="efc-row">' +
      '<input class="efc-author" maxlength="24" placeholder="昵称 *" required>' +
      '<input class="efc-email" type="email" placeholder="邮箱（可选，不公开）">' +
      '</div>' +
      '<textarea class="efc-content" maxlength="2000" placeholder="友善评论，从我做起…" required></textarea>' +
      '<input class="efc-website" type="text" tabindex="-1" autocomplete="off">' +
      '<div class="efc-actions"><button type="submit" class="efc-submit">发 布</button>' +
      (parentId ? '<button type="button" class="efc-cancel">取 消</button>' : '') + '</div>';
    f.querySelector('.efc-website').style.display = 'none';
    if (parentId) {
      f.querySelector('.efc-cancel').onclick = function () { onDone(null); };
    }
    f.onsubmit = function (ev) {
      ev.preventDefault();
      var btn = f.querySelector('.efc-submit');
      btn.disabled = true;
      fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: f._pagePath,
          parent: parentId || '',
          author: f.querySelector('.efc-author').value.trim(),
          email: f.querySelector('.efc-email').value.trim(),
          content: f.querySelector('.efc-content').value.trim(),
          website: f.querySelector('.efc-website').value,
        }),
      }).then(function (r) { return r.json(); })
        .then(function (j) {
          if (j.ok) { onDone(j); } else { throw new Error(j.error || '发表失败'); }
        })
        .catch(function (e) { alert(e.message); btn.disabled = false; });
    };
    return f;
  }

  function renderComment(c, byParent, reload) {
    var item = document.createElement('div');
    item.className = 'efc-item';
    var first = (c.author || '?').trim().charAt(0).toUpperCase();
    item.innerHTML =
      '<div class="efc-avatar" style="background:' + avatarColor(c.author || '?') + '">' + esc(first) + '</div>' +
      '<div class="efc-body">' +
      '<div class="efc-meta"><span class="efc-name">' + esc(c.author) + '</span>' +
      '<span class="efc-time">' + esc(c.time) + '</span>' +
      '<a class="efc-reply">回复</a></div>' +
      '<div class="efc-content">' + esc(c.content).replace(/\n/g, '<br>') + '</div>' +
      '<div class="efc-children"></div>' +
      '</div>';
    var childrenBox = item.querySelector('.efc-children');
    (byParent[c.id] || []).forEach(function (child) {
      childrenBox.appendChild(renderComment(child, byParent, reload));
    });
    item.querySelector('.efc-reply').onclick = function () {
      // 同一时刻只允许一个回复框
      var existing = item.querySelector(':scope > .efc-body > .efc-form');
      if (existing) { existing.remove(); return; }
      var holder = item.querySelector(':scope > .efc-body');
      var f = commentForm(c.id, function (j) {
        if (j) reload(); else f.remove();
      });
      f._pagePath = item._pagePath;
      holder.insertBefore(f, childrenBox);
      f.querySelector('.efc-author').focus();
    };
    return item;
  }

  function initComments() {
    if (P.comments !== 'builtin') return;
    var box = document.getElementById('efar-comments');
    if (!box) return;
    var path = box.getAttribute('data-path');

    var load = function () {
      fetch('/api/comments?path=' + encodeURIComponent(path))
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var list = (j && j.comments) || [];
          box.innerHTML = '';
          var root = document.createElement('div');
          root.className = 'efc';
          root.innerHTML = '<div class="efc-header">' + list.length + ' 条评论</div>';
          var topForm = commentForm('', function (j) { if (j) load(); });
          topForm._pagePath = path;
          root.appendChild(topForm);
          var byParent = {};
          list.forEach(function (c) {
            (byParent[c.parent] = byParent[c.parent] || []).push(c);
          });
          var listBox = document.createElement('div');
          listBox.className = 'efc-list';
          (byParent[''] || []).forEach(function (c) {
            var el = renderComment(c, byParent, load);
            el._pagePath = path;
            // 让子项能拿到页面路径
            (function mark(e, p) {
              e._pagePath = p;
              var kids = e.querySelectorAll('.efc-item');
              for (var i = 0; i < kids.length; i++) kids[i]._pagePath = p;
            })(el, path);
            listBox.appendChild(el);
          });
          root.appendChild(listBox);
          box.appendChild(root);
        })
        .catch(function () {});
    };
    load();
  }

  /* ---------- 图片灯箱 ---------- */

  function initLightbox() {
    if (!P.lightbox) return;
    var imgs = document.querySelectorAll('#main .body.md img, #main .post.block img');
    imgs.forEach(function (img) {
      if (img._lb) return;
      img._lb = true;
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', function (ev) {
        ev.preventDefault();
        var src = img.getAttribute('data-src') || img.src;
        var ov = document.createElement('div');
        ov.className = 'efc-lightbox';
        ov.innerHTML = '<img src="' + esc(src) + '" alt="">';
        ov.onclick = function () { ov.remove(); };
        document.addEventListener('keydown', function onEsc(e) {
          if (e.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', onEsc); }
        });
        document.body.appendChild(ov);
      });
    });
  }

  /* ---------- KaTeX ---------- */

  function initKatex() {
    if (!P.katex) return;
    var body = document.querySelector('.body.md');
    if (!body) return;
    var formulas = body.querySelectorAll('[data-w-e-type="formula"], [data-w-e-type="inlineFormula"]');
    var needAuto = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]/.test(body.textContent);
    if (!formulas.length && !needAuto) return;
    loadScript('/js/vendor/katex/katex.min.js', function () {
      loadScript('/js/vendor/katex/auto-render.min.js', function () {
        // wangEditor 公式节点
        formulas.forEach(function (el) {
          var tex = el.getAttribute('data-value') || el.textContent;
          try { window.katex.render(tex, el, { displayMode: el.getAttribute('data-w-e-type') === 'formula' }); } catch (e) {}
        });
        // markdown 文本中的 $...$ / $$...$$
        if (needAuto && window.renderMathInElement) {
          window.renderMathInElement(body, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '$', right: '$', display: false },
              { left: '\\[', right: '\\]', display: true },
              { left: '\\(', right: '\\)', display: false },
            ],
            ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
          });
        }
      });
    });
  }

  /* ---------- mermaid ---------- */

  function initMermaid() {
    if (!P.mermaid) return;
    var blocks = document.querySelectorAll('pre.mermaid');
    if (!blocks.length) return;
    loadScript('/js/vendor/mermaid.min.js', function () {
      if (window.mermaid) {
        window.mermaid.initialize({ startOnLoad: false, theme: 'default' });
        window.mermaid.run({ nodes: blocks }).catch(function () {});
      }
    });
  }

  /* ---------- 初始化（含 PJAX） ---------- */

  function initAll() {
    initViews();
    initComments();
    initLightbox();
    initKatex();
    initMermaid();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
  window.addEventListener('pjax:success', initAll);
})();
