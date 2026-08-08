// Shared by index.html, history.html, team.html, and login.html —
// populates the "vX.Y.Z" footer link from the public /api/version endpoint.
(function () {
  var el = document.getElementById('versionLink');
  if (!el) return;

  fetch('/api/version')
    .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
    .then(function (data) {
      var version = data.version;
      var date = data.date;
      var dateStr = '';
      if (date) {
        var d = new Date(date + 'T00:00:00');
        if (!isNaN(d.getTime())) {
          dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }
      }
      el.textContent = dateStr ? ('v' + version + ' · released ' + dateStr) : ('v' + version);
    })
    .catch(function () {
      el.textContent = 'Changelog';
    });
})();
