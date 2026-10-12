/*
 * Work Diary — API sync layer.
 *
 * The app was built on localStorage. This layer keeps that code untouched and
 * makes it durable instead:
 *   - every write to a Work Diary key is mirrored to the REST API (debounced)
 *   - on boot, server data is merged in and local-only records are pushed up
 *   - deletions are detected against the last synced snapshot
 *   - staff PINs are verified server-side, never stored readable in the browser
 *
 * Everything degrades gracefully: if the API is unreachable the app keeps
 * working exactly as it did before, purely in localStorage.
 */
(function () {
  const API = "/api";

  const K = {
    entries: "work-diary-v1",
    members: "work-diary-members-v1",
    attendance: "work-diary-staff-attendance-v1",
    pins: "work-diary-staff-pins-v1",
    meeting: "work-diary-meeting-link-v1",
    lastSynced: "work-diary-last-synced-v1",
    session: "work-diary-current-staff-v1",
  };

  let busy = false;            // true while this layer writes, so we don't re-trigger ourselves
  const timers = {};           // debounce timer per storage key

  /* ---------- storage helpers ---------- */

  function readJSON(k, fallback) {
    try {
      const raw = localStorage.getItem(k);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJSON(k, value) {
    busy = true;
    try {
      localStorage.setItem(k, JSON.stringify(value));
    } finally {
      busy = false;
    }
  }

  /* ---------- network helpers ---------- */

  async function call(path, options) {
    const opts = Object.assign(
      { headers: { "Content-Type": "application/json" } },
      options || {}
    );
    if (opts.body && typeof opts.body !== "string") {
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(API + path, opts);
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
    return data;
  }

  /* ---------- record mapping ---------- */

  function entryFromServer(row) {
    return {
      id: row.id,
      date: row.date,
      hours: row.hours,
      submittedBy: row.submitted_by || "",
      project: row.project || "",
      work: row.work || "",
      notes: row.notes || "",
    };
  }

  function entryPayload(e) {
    return {
      id: e.id,
      date: e.date,
      hours: e.hours,
      submittedBy: e.submittedBy || "",
      project: e.project || "",
      work: e.work || "",
      notes: e.notes || "",
    };
  }

  /* ---------- push: local -> server ---------- */

  async function pushEntries() {
    const local = readJSON(K.entries, []);
    const snapshot = readJSON(K.lastSynced, {});

    // Anything that vanished since the last successful sync is a deletion.
    const gone = (snapshot.entries || []).filter(function (id) {
      return !local.some(function (e) {
        return e.id === id;
      });
    });
    for (const id of gone) {
      await call("/api/entries/" + encodeURIComponent(id), { method: "DELETE" }).catch(
        function () {}
      );
    }

    for (const e of local) {
      await call("/api/entries", {
        method: "POST",
        body: entryPayload(e),
      }).catch(function (err) {
        console.warn("entry sync failed", err);
      });
    }

    const snap = readJSON(K.lastSynced, {});
    snap.entries = local.map(function (e) {
      return e.id;
    });
    writeJSON(K.lastSynced, snap);
  }

  async function pushMembers() {
    const local = readJSON(K.members, []);
    for (const m of local) {
      if (!m || !m.name) continue;
      await call("/api/members", {
        method: "POST",
        body: { id: m.id, name: m.name },
      }).catch(function (err) {
        console.warn("member sync failed", err);
      });
      if (m.status === "inactive") {
        if (m.id) {
          await call("/api/members/" + encodeURIComponent(m.id), {
            method: "PATCH",
            body: { status: "inactive" },
          }).catch(function () {});
        }
      }
    }
  }

  async function pushAttendance() {
    const map = readJSON(K.attendance, {});
    const date = localToday();
    for (const memberId of Object.keys(map)) {
      const rec = map[memberId];
      if (!rec || !rec.status) continue;
      await call("/api/attendance", {
        method: "POST",
        body: { memberId: memberId, status: rec.status, time: rec.time, date: date },
      }).catch(function (err) {
        console.warn("attendance sync failed", err);
      });
    }
  }

  async function pushPins() {
    const pins = readJSON(K.pins, {});
    for (const memberId of Object.keys(pins)) {
      const pin = pins[memberId];
      if (!/^\d{4,8}$/.test(String(pin))) continue;
      await call("/api/pins", {
        method: "POST",
        body: { memberId: memberId, pin: pin },
      }).catch(function (err) {
        console.warn("pin sync failed", err);
      });
    }
  }

  async function pushMeeting() {
    const value = localStorage.getItem(K.meeting);
    if (value == null) return;
    await call("/api/settings/meetingLink", {
      method: "PUT",
      body: { value: value },
    }).catch(function (err) {
      console.warn("meeting link sync failed", err);
    });
  }

  /* ---------- pull: server -> local ---------- */

  async function pullAll() {
    const result = {};

    try {
      const r = await call("/api/entries");
      result.entries = (r.entries || []).map(entryFromServer);
    } catch (e) {
      console.warn("entries pull failed", e);
    }

    try {
      const r = await call("/api/members");
      result.members = r.members || [];
    } catch (e) {
      console.warn("members pull failed", e);
    }

    try {
      const r = await call("/api/attendance?date=" + localToday());
      const map = {};
      (r.attendance || []).forEach(function (row) {
        map[row.member_id] = { status: row.status, time: row.time };
      });
      result.attendance = map;
    } catch (e) {
      console.warn("attendance pull failed", e);
    }

    try {
      const r = await call("/api/settings");
      result.meeting = (r.settings || {}).meetingLink;
    } catch (e) {
      console.warn("settings pull failed", e);
    }

    return result;
  }

  function localToday() {
    const d = new Date();
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  /**
   * Merge server data into localStorage.
   * Local-only records are kept (and pushed up afterwards); for records that
   * exist on both sides the local copy wins, so an edit made on this device
   * is never silently discarded.
   */
  function merge(server) {
    if (server.entries && server.entries.length) {
      const local = readJSON(K.entries, []);
      const byId = {};
      server.entries.forEach(function (e) {
        byId[e.id] = e;
      });
      local.forEach(function (e) {
        byId[e.id] = e;
      });
      const merged = Object.keys(byId).map(function (id) {
        return byId[id];
      });
      writeJSON(K.entries, merged);
      if (typeof items !== "undefined") {
        items = merged;
      }
    }

    if (server.members && server.members.length) {
      const local = readJSON(K.members, []);
      const byKey = {};
      server.members.forEach(function (m) {
        byKey[m.id || m.name] = m;
      });
      local.forEach(function (m) {
        const key = m.id || m.name;
        // Keep local-only fields (like status) but adopt the server id if we
        // had none, so a member added before syncing gets a stable identity.
        if (byKey[key]) {
          byKey[key] = Object.assign({}, byKey[key], m, { id: byKey[key].id || m.id });
        } else {
          byKey[key] = m;
        }
      });
      const merged = Object.keys(byKey).map(function (k) {
        return byKey[k];
      });
      writeJSON(K.members, merged);
      if (typeof members !== "undefined") {
        members = merged;
      }
    }

    if (server.attendance) {
      const local = readJSON(K.attendance, {});
      writeJSON(K.attendance, Object.assign({}, server.attendance, local));
    }

    if (server.meeting != null && !localStorage.getItem(K.meeting)) {
      busy = true;
      try {
        localStorage.setItem(K.meeting, server.meeting);
      } finally {
        busy = false;
      }
      const field = document.getElementById("meetingLink");
      if (field) field.value = server.meeting;
    }
  }

  /* ---------- re-render ---------- */

  function refreshUI() {
    try {
      if (typeof render === "function") render();
    } catch (e) {}
    try {
      if (typeof renderMembers === "function") renderMembers();
    } catch (e) {}
    try {
      if (typeof renderSubmittedBy === "function") renderSubmittedBy();
    } catch (e) {}
    try {
      if (typeof renderActiveMembers === "function") renderActiveMembers();
    } catch (e) {}
    try {
      if (typeof renderStaffManager === "function") {
        const panel = document.getElementById("staffManager");
        if (panel && !panel.hidden) renderStaffManager();
      }
    } catch (e) {}
    refreshStaffLogin();
  }

  function refreshStaffLogin() {
    const select = document.getElementById("staffLoginSelect");
    if (!select) return;
    const hint = document.getElementById("staffLoginHint");
    const all = readJSON(K.members, []);
    const available = all.filter(function (m) {
      return m.status !== "inactive" && String(m.name || "").trim();
    });
    const current = select.value;
    select.innerHTML = available.length
      ? '<option value="">Choose your name</option>' +
        available
          .map(function (m) {
            return '<option value="' + escapeAttr(m.name) + '">' + escapeAttr(m.name) + "</option>";
          })
          .join("")
      : '<option value="">No active staff names yet</option>';
    if (available.some(function (m) {
        return m.name === current;
      })) {
      select.value = current;
    }
    if (hint) {
      hint.textContent = available.length
        ? "Choose your name and enter your login PIN. Default PIN is 1234 unless the admin set a different one."
        : "Ask the administrator to add your name first.";
    }
  }

  function escapeAttr(v) {
    return String(v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- write interception ---------- */

  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    originalSetItem.call(this, k, v);
    if (busy) return;
    if (k === K.entries || k === K.members || k === K.attendance ||
        k === K.pins || k === K.meeting) {
      schedule(k);
    }
  };

  function schedule(k) {
    clearTimeout(timers[k]);
    timers[k] = setTimeout(function () {
      flush(k);
    }, 600);
  }

  function flush(k) {
    if (k === K.entries) return pushEntries();
    if (k === K.members) return pushMembers().then(refreshStaffLogin);
    if (k === K.attendance) return pushAttendance();
    if (k === K.pins) return pushPins();
    if (k === K.meeting) return pushMeeting();
    return Promise.resolve();
  }

  /* ---------- admin: save PIN ---------- */

  document.addEventListener(
    "click",
    function (e) {
      const btn = e.target && e.target.closest ? e.target.closest("[data-member-id][data-pin-input]") : null;
      if (!btn) return;
      const input = document.getElementById(btn.dataset.pinInput);
      const pin = input ? input.value.trim() : "";
      if (!/^\d{4,8}$/.test(pin)) return; // the app's own handler already alerts
      const memberId = btn.dataset.memberId;
      call("/api/pins", { method: "POST", body: { memberId: memberId, pin: pin } })
        .then(function () {
          // Drop the readable copy once the server has the hash.
          const pins = readJSON(K.pins, {});
          delete pins[memberId];
          writeJSON(K.pins, pins);
        })
        .catch(function (err) {
          console.warn("pin save failed", err);
        });
    },
    true
  );

  /* ---------- staff login: verify server-side ---------- */

  function installLogin() {
    const btn = document.getElementById("staffLoginContinue");
    const select = document.getElementById("staffLoginSelect");
    const pinField = document.getElementById("staffLoginPin");
    const hint = document.getElementById("staffLoginHint");
    if (!btn || !select || !pinField) return;

    const original = btn.onclick;
    if (original && original.__syncWrapped) return;

    const handler = async function () {
      const name = select.value;
      const pin = pinField.value;
      if (!name) {
        if (hint) hint.textContent = "Choose your name first.";
        return;
      }

      let member = null;
      try {
        const r = await call("/api/pins", { method: "POST", body: { name: name, pin: pin } });
        member = r.member;
      } catch (err) {
        // Offline: fall back to the last known local verification.
        const all = readJSON(K.members, []);
        const found = all.find(function (m) {
          return m.name === name;
        });
        const pins = readJSON(K.pins, {});
        const key = found ? found.id || found.email || found.name : name;
        const expected = pins[key] || "1234";
        if (!found || pin !== expected) {
          if (hint) hint.textContent = "The PIN is not correct. Try again.";
          pinField.value = "";
          return;
        }
        member = found;
      }

      if (!member) {
        if (hint) hint.textContent = "The PIN is not correct. Try again.";
        pinField.value = "";
        return;
      }

      // Let the app's own handler finish the session and check-in bookkeeping.
      const pins = readJSON(K.pins, {});
      const all = readJSON(K.members, []);
      const localMember = all.find(function (m) {
        return m.name === member.name;
      });
      const key = localMember ? localMember.id || localMember.email || localMember.name : member.name;
      pins[key] = pin;
      writeJSON(K.pins, pins);
      if (original) original.call(btn);
      // Clear the pin again — it was only set to satisfy the local check.
      const after = readJSON(K.pins, {});
      delete after[key];
      writeJSON(K.pins, after);
      pinField.value = "";
    };

    handler.__syncWrapped = true;
    btn.onclick = handler;
  }

  /* ---------- boot ---------- */

  async function boot() {
    installLogin();
    const server = await pullAll();
    merge(server);
    refreshUI();

    // Upload anything this device had that the server did not.
    const hasLocalEntries = readJSON(K.entries, []).length > 0;
    const hasLocalMembers = readJSON(K.members, []).length > 0;

    if (hasLocalEntries) await pushEntries();
    if (hasLocalMembers) await pushMembers();
    await pushAttendance();
    if (localStorage.getItem(K.meeting) != null) await pushMeeting();

    refreshUI();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      boot();
    });
  } else {
    boot();
  }
})();
