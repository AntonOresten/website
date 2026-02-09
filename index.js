(function () {
  var root = document.getElementById('category-root');
  if (!root) return;

  function groupByCategory(posts) {
    return posts.reduce(function (acc, post) {
      var slug = post.categorySlug || 'uncategorized';
      if (!acc[slug]) {
        acc[slug] = {
          slug: slug,
          name: post.category || 'Uncategorized',
          order: Number.isFinite(post.categoryOrder) ? post.categoryOrder : Number.MAX_SAFE_INTEGER,
          posts: [],
        };
      }
      acc[slug].posts.push(post);
      return acc;
    }, {});
  }

  function createSection(category) {
    var section = document.createElement('section');
    section.className = 'home-section';

    var headingRow = document.createElement('div');
    headingRow.className = 'home-section-head';

    var heading = document.createElement('h2');
    heading.textContent = category.name;
    headingRow.appendChild(heading);

    var count = document.createElement('span');
    count.className = 'home-count';
    count.textContent = String(category.posts.length).padStart(2, '0');
    headingRow.appendChild(count);

    section.appendChild(headingRow);

    var list = document.createElement('ul');
    list.className = 'essay-list';

    category.posts.forEach(function (post) {
      var item = document.createElement('li');
      item.className = 'home-entry';

      var link = document.createElement('a');
      link.className = 'home-entry-title';
      link.href = post.urlPath;
      link.textContent = post.title;

      var description = document.createElement('p');
      description.className = 'home-entry-dek';
      description.textContent = post.description || '';

      var time = document.createElement('time');
      time.className = 'home-entry-date';
      time.dateTime = post.date;
      time.textContent = post.prettyDate || post.date;

      item.appendChild(link);
      item.appendChild(description);
      item.appendChild(time);
      list.appendChild(item);
    });

    section.appendChild(list);
    return section;
  }

  function render(posts) {
    root.innerHTML = '';

    if (!posts.length) {
      var empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No posts found. Add one under categories/<category-slug>/<post-slug>/content.md.';
      root.appendChild(empty);
      return;
    }

    var grouped = groupByCategory(posts);

    Object.keys(grouped)
      .map(function (slug) {
        return grouped[slug];
      })
      .sort(function (a, b) {
        if (a.order !== b.order) return a.order - b.order;
        return a.name.localeCompare(b.name);
      })
      .forEach(function (category) {
        root.appendChild(createSection(category));
      });
  }

  fetch('content/posts.json', { cache: 'no-store' })
    .then(function (res) {
      if (!res.ok) throw new Error('Failed to load posts');
      return res.json();
    })
    .then(render)
    .catch(function () {
      root.innerHTML = '<p class="empty-state">Could not load post index. Run <code>npm run build</code>.</p>';
    });
})();
