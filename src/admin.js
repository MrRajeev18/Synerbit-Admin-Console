/**
 * Synerbit Admin Console Engine
 * Includes Role-Based Access Control (RBAC), Firebase Integration,
 * and CRUD operations for Products, Jobs, Applications, and Ideas.
 */

import { firebaseConfig, isFirebaseConfigured } from './firebase.js';

// Local storage helper
const getLocal = (key, fallback = []) => {
  try {
    const val = localStorage.getItem(`synerbit_${key}`);
    return val ? JSON.parse(val) : fallback;
  } catch {
    return fallback;
  }
};

const setLocal = (key, val) => {
  try {
    localStorage.setItem(`synerbit_${key}`, JSON.stringify(val));
  } catch (err) {
    console.error(`Error saving ${key}:`, err);
  }
};

// State
let currentUser = null;
let currentProducts = [];
let currentJobs = [];
let currentApplications = [];
let currentIdeas = [];
let currentContacts = [];
let currentTeam = [];

// DOM Elements
const authScreen = document.getElementById('auth-screen');
const adminApp = document.getElementById('admin-app');
const loginForm = document.getElementById('admin-login-form');
const authError = document.getElementById('auth-error-msg');
const logoutBtn = document.getElementById('btn-admin-logout');

// Sidebar user info
const userNameEl = document.getElementById('sidebar-user-name');
const userRoleEl = document.getElementById('sidebar-user-role');
const userAvatarEl = document.getElementById('sidebar-user-avatar');

// Navigation tabs
const navTabs = document.querySelectorAll('.nav-tab');
const contentPanels = document.querySelectorAll('.content-panel');
const viewTitle = document.getElementById('current-view-title');
const viewDesc = document.getElementById('current-view-desc');

// View descriptions map
const VIEW_META = {
  dashboard: { title: 'Dashboard Overview', desc: 'High-level ecosystem telemetry and active queues.' },
  products: { title: 'Products Catalog', desc: 'Manage software platforms displayed on synerbit.in/products.html' },
  jobs: { title: 'Career Openings', desc: 'Post, edit, or close roles displayed on synerbit.in/jobs.html' },
  applications: { title: 'Job Applications Inbox', desc: 'Review candidates who applied on the careers page.' },
  ideas: { title: 'SaaS Concept Pitches', desc: 'Submissions received from synerbit.in/submit-idea.html' },
  contacts: { title: 'Contact Messages', desc: 'Inquiries sent via contact buttons and forms.' },
  team: { title: 'Team & Role Permissions', desc: 'Grant or restrict module-level permissions for console users.' }
};

/* ==========================================================================
   AUTHENTICATION & RBAC PERMISSION ENFORCEMENT
   ========================================================================== */

function initAuth() {
  // Bind Logout Listener Unconditionally
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleSignOut);
  }
  window.handleAdminSignOut = handleSignOut;

  // Handle Login Form Submit (Strict Firebase Authentication Only)
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value.trim();

      authError.style.display = 'none';

      const btnSubmit = document.getElementById('btn-login-submit');
      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.textContent = 'Verifying with Firebase...';
      }

      try {
        const { getAuth, signInWithEmailAndPassword } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
        const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
        const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const userCred = await signInWithEmailAndPassword(auth, email, password);
        resolveUserPermissions(userCred.user.email);
      } catch (err) {
        console.error('Firebase Auth error:', err);
        let friendlyMsg = err.message || 'Firebase login failed';
        if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
          friendlyMsg = 'Invalid email or password. Please check your credentials.';
        } else if (err.code === 'auth/network-request-failed') {
          friendlyMsg = 'Network error connecting to Firebase. Check internet connection.';
        }
        authError.textContent = friendlyMsg;
        authError.style.display = 'block';
      } finally {
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.textContent = 'Sign In to Console';
        }
      }
    });
  }

  // Check stored session on startup
  const storedSession = sessionStorage.getItem('synerbit_admin_session');
  if (storedSession) {
    try {
      currentUser = JSON.parse(storedSession);
      enterAdminApp();
    } catch (e) {
      sessionStorage.removeItem('synerbit_admin_session');
    }
  }

  // Monitor Firebase Auth state change for token renewal and live reconnect
  if (isFirebaseConfigured()) {
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js").then(({ getAuth, onAuthStateChanged }) => {
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js").then(({ initializeApp, getApps }) => {
        const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
        const auth = getAuth(app);
        onAuthStateChanged(auth, async (fbUser) => {
          if (fbUser) {
            console.log("Firebase Auth active user confirmed:", fbUser.email);
            if (!currentUser) {
              resolveUserPermissions(fbUser.email);
            } else if (adminApp.style.display !== 'none') {
              // Re-sync data now that auth state is officially verified in browser
              loadAllData();
            }
          }
        });
      });
    }).catch(err => console.warn("Firebase Auth listener setup warning:", err));
  }
}

async function handleSignOut() {
  sessionStorage.removeItem('synerbit_admin_session');
  currentUser = null;

  if (isFirebaseConfigured()) {
    try {
      const { getAuth, signOut } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const auth = getAuth(app);
      await signOut(auth);
    } catch (err) {
      console.warn('Firebase sign out error:', err);
    }
  }

  adminApp.style.display = 'none';
  authScreen.style.display = 'flex';
  if (loginForm) loginForm.reset();
  if (authError) authError.style.display = 'none';
}

function resolveUserPermissions(email) {
  const team = getLocal('team', []);
  const found = team.find(m => m.email.toLowerCase() === email.toLowerCase());

  if (found) {
    loginUser(found);
  } else if (email.toLowerCase() === 'rajeev@synerbit.in' || email.includes('admin')) {
    // Default Super Admin fallback
    const superAdmin = {
      id: 'admin-super',
      name: 'Rajeev Ranjan',
      email: email,
      role: 'Super Admin',
      isSuperAdmin: true,
      permissions: {
        products: true,
        jobs: true,
        applications: true,
        ideas: true,
        contacts: true,
        team: true
      }
    };
    loginUser(superAdmin);
  } else {
    authError.textContent = `No authorized account found for ${email}. Contact the Super Admin.`;
    authError.style.display = 'block';
  }
}

function loginUser(user) {
  currentUser = user;
  sessionStorage.setItem('synerbit_admin_session', JSON.stringify(user));
  enterAdminApp();
}

function enterAdminApp() {
  authScreen.style.display = 'none';
  adminApp.style.display = 'flex';

  // Render User Pill
  userNameEl.textContent = currentUser.name || currentUser.email;
  userRoleEl.textContent = currentUser.role || 'Team Member';
  userAvatarEl.textContent = (currentUser.name || currentUser.email)[0].toUpperCase();

  // Enforce Granular RBAC on Sidebar Tabs
  enforcePermissions();

  // Load All Collections
  loadAllData();
}

/**
 * Dynamically hide / show sidebar tabs based on the user's permissions
 */
function enforcePermissions() {
  const p = currentUser.permissions || {};
  const isSuper = currentUser.isSuperAdmin === true;

  document.getElementById('tab-btn-products').style.display = (p.products || isSuper) ? 'flex' : 'none';
  document.getElementById('tab-btn-jobs').style.display = (p.jobs || isSuper) ? 'flex' : 'none';
  document.getElementById('tab-btn-applications').style.display = (p.applications || isSuper) ? 'flex' : 'none';
  document.getElementById('tab-btn-ideas').style.display = (p.ideas || isSuper) ? 'flex' : 'none';
  document.getElementById('tab-btn-contacts').style.display = (p.contacts || isSuper) ? 'flex' : 'none';
  
  // Team Management is strictly Super Admin
  const teamSection = document.getElementById('section-admin-only');
  const teamTab = document.getElementById('tab-btn-team');
  teamSection.style.display = isSuper ? 'block' : 'none';
  teamTab.style.display = isSuper ? 'flex' : 'none';
}

/* ==========================================================================
   NAVIGATION
   ========================================================================== */

navTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    switchTab(target);
  });
});

function switchTab(tabId) {
  navTabs.forEach(t => t.classList.remove('active'));
  contentPanels.forEach(p => p.classList.remove('active'));

  const activeBtn = document.querySelector(`.nav-tab[data-tab="${tabId}"]`);
  const activePanel = document.getElementById(`panel-${tabId}`);

  if (activeBtn) activeBtn.classList.add('active');
  if (activePanel) activePanel.classList.add('active');

  if (VIEW_META[tabId]) {
    viewTitle.textContent = VIEW_META[tabId].title;
    viewDesc.textContent = VIEW_META[tabId].desc;
  }
}

/* ==========================================================================
   DATA LOADING & RENDERING
   ========================================================================== */

function formatDateTime(val) {
  if (!val) return 'Recent';
  if (typeof val?.toDate === 'function') {
    return val.toDate().toLocaleDateString();
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? 'Recent' : d.toLocaleDateString();
}

let realtimeUnsubscribes = [];

function setupRealtimeListeners(db) {
  realtimeUnsubscribes.forEach(unsub => {
    try { if (typeof unsub === 'function') unsub(); } catch (_) {}
  });
  realtimeUnsubscribes = [];

  import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js").then(({ collection, onSnapshot }) => {
    // 1. Applications Listener
    try {
      const unsubApps = onSnapshot(collection(db, "job_applications"), (snapshot) => {
        if (!snapshot.empty) {
          const liveApps = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          liveApps.sort((a, b) => {
            const dateA = new Date(a.submittedAt || a.createdAt || 0).getTime();
            const dateB = new Date(b.submittedAt || b.createdAt || 0).getTime();
            return dateB - dateA;
          });
          currentApplications = liveApps;
          setLocal('applications', liveApps);
          updateAllUIPanels();
        }
      }, err => console.warn("Live applications listener note:", err));
      realtimeUnsubscribes.push(unsubApps);
    } catch (_) {}

    // 2. Ideas Listener
    try {
      const unsubIdeas = onSnapshot(collection(db, "idea_submissions"), (snapshot) => {
        if (!snapshot.empty) {
          const liveIdeas = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          liveIdeas.sort((a, b) => {
            const dateA = new Date(a.submittedAt || a.createdAt || 0).getTime();
            const dateB = new Date(b.submittedAt || b.createdAt || 0).getTime();
            return dateB - dateA;
          });
          currentIdeas = liveIdeas;
          setLocal('ideas', liveIdeas);
          updateAllUIPanels();
        }
      }, err => console.warn("Live ideas listener note:", err));
      realtimeUnsubscribes.push(unsubIdeas);
    } catch (_) {}

    // 3. Jobs Listener
    try {
      const unsubJobs = onSnapshot(collection(db, "jobs"), (snapshot) => {
        if (!snapshot.empty) {
          currentJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          setLocal('jobs', currentJobs);
          updateAllUIPanels();
        }
      }, err => console.warn("Live jobs listener note:", err));
      realtimeUnsubscribes.push(unsubJobs);
    } catch (_) {}

    // 4. Products Listener
    try {
      const unsubProds = onSnapshot(collection(db, "products"), (snapshot) => {
        if (!snapshot.empty) {
          currentProducts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          setLocal('products', currentProducts);
          updateAllUIPanels();
        }
      }, err => console.warn("Live products listener note:", err));
      realtimeUnsubscribes.push(unsubProds);
    } catch (_) {}

    // 5. Contact Messages Listener
    try {
      const unsubContacts = onSnapshot(collection(db, "contact_messages"), (snapshot) => {
        if (!snapshot.empty) {
          const liveContacts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          liveContacts.sort((a, b) => {
            const dateA = new Date(a.submittedAt || a.createdAt || 0).getTime();
            const dateB = new Date(b.submittedAt || b.createdAt || 0).getTime();
            return dateB - dateA;
          });
          currentContacts = liveContacts;
          setLocal('contacts', liveContacts);
          updateAllUIPanels();
        }
      }, err => console.warn("Live contacts listener note:", err));
      realtimeUnsubscribes.push(unsubContacts);
    } catch (_) {}
  }).catch(err => console.warn("Could not setup realtime Firestore listeners:", err));
}

function updateAllUIPanels() {
  const kpiProducts = document.getElementById('kpi-products-count');
  const kpiJobs = document.getElementById('kpi-jobs-count');
  const kpiApps = document.getElementById('kpi-apps-count');
  const kpiIdeas = document.getElementById('kpi-ideas-count');
  const kpiContacts = document.getElementById('kpi-contacts-count');
  const badgeApps = document.getElementById('badge-applications-count');
  const badgeIdeas = document.getElementById('badge-ideas-count');
  const badgeContacts = document.getElementById('badge-contacts-count');

  if (kpiProducts) kpiProducts.textContent = currentProducts.length;
  if (kpiJobs) kpiJobs.textContent = currentJobs.length;
  if (kpiApps) kpiApps.textContent = currentApplications.length;
  if (kpiIdeas) kpiIdeas.textContent = currentIdeas.length;
  if (kpiContacts) kpiContacts.textContent = currentContacts.length;

  if (badgeApps) badgeApps.textContent = currentApplications.length;
  if (badgeIdeas) badgeIdeas.textContent = currentIdeas.length;
  if (badgeContacts) badgeContacts.textContent = currentContacts.length;

  renderDashboardActivity();
  renderProductsTable();
  renderJobsTable();
  renderApplicationsTable();
  renderIdeasTable();
  renderContactsTable();
  renderTeamTable();
}

async function loadAllData() {
  // Load local cache immediately to prevent blank flash
  currentProducts = getLocal('products', []);
  currentJobs = getLocal('jobs', []);
  currentApplications = getLocal('applications', []);
  currentIdeas = getLocal('ideas', []);
  currentContacts = getLocal('contacts', []);
  currentTeam = getLocal('team', []);

  updateAllUIPanels();

  // Live Firebase sync if configured
  if (isFirebaseConfigured()) {
    const statusText = document.getElementById('firestore-sync-status-text');
    if (statusText) statusText.textContent = 'Firestore: Syncing...';

    try {
      const { getFirestore, collection, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(app);

      // 1. Fetch Job Applications (Check both 'job_applications' & 'applications')
      try {
        const appMap = new Map();
        try {
          const snap1 = await getDocs(collection(db, "job_applications"));
          snap1.forEach(d => appMap.set(d.id, { id: d.id, ...d.data() }));
        } catch (e1) {
          console.warn("Could not query 'job_applications':", e1);
        }

        try {
          const snap2 = await getDocs(collection(db, "applications"));
          snap2.forEach(d => {
            if (!appMap.has(d.id)) appMap.set(d.id, { id: d.id, ...d.data() });
          });
        } catch (_) {}

        if (appMap.size > 0) {
          currentApplications = Array.from(appMap.values());
          currentApplications.sort((a, b) => {
            const dateA = new Date(a.submittedAt || a.createdAt || 0).getTime();
            const dateB = new Date(b.submittedAt || b.createdAt || 0).getTime();
            return dateB - dateA;
          });
          setLocal('applications', currentApplications);
        }
      } catch (err) {
        console.warn("Application inbox sync issue:", err);
      }

      // 2. Fetch Jobs (Career Positions)
      try {
        const jSnap = await getDocs(collection(db, "jobs"));
        if (!jSnap.empty) {
          currentJobs = jSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          setLocal('jobs', currentJobs);
        }
      } catch (err) {
        console.warn("Job positions sync issue:", err);
      }

      // 3. Fetch Products
      try {
        const pSnap = await getDocs(collection(db, "products"));
        if (!pSnap.empty) {
          currentProducts = pSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          setLocal('products', currentProducts);
        }
      } catch (err) {
        console.warn("Products sync issue:", err);
      }

      // 4. Fetch SaaS Ideas
      try {
        const ideaMap = new Map();
        try {
          const iSnap1 = await getDocs(collection(db, "idea_submissions"));
          iSnap1.forEach(d => ideaMap.set(d.id, { id: d.id, ...d.data() }));
        } catch (_) {}

        try {
          const iSnap2 = await getDocs(collection(db, "ideas"));
          iSnap2.forEach(d => {
            if (!ideaMap.has(d.id)) ideaMap.set(d.id, { id: d.id, ...d.data() });
          });
        } catch (_) {}

        if (ideaMap.size > 0) {
          currentIdeas = Array.from(ideaMap.values());
          currentIdeas.sort((a, b) => {
            const dateA = new Date(a.submittedAt || a.createdAt || 0).getTime();
            const dateB = new Date(b.submittedAt || b.createdAt || 0).getTime();
            return dateB - dateA;
          });
          setLocal('ideas', currentIdeas);
        }
      } catch (err) {
        console.warn("Ideas sync issue:", err);
      }

      // 5. Fetch Contact Inquiries
      try {
        const contactMap = new Map();
        try {
          const cSnap1 = await getDocs(collection(db, "contact_messages"));
          cSnap1.forEach(d => contactMap.set(d.id, { id: d.id, ...d.data() }));
        } catch (_) {}

        try {
          const cSnap2 = await getDocs(collection(db, "contacts"));
          cSnap2.forEach(d => {
            if (!contactMap.has(d.id)) contactMap.set(d.id, { id: d.id, ...d.data() });
          });
        } catch (_) {}

        // Merge local cache so fresh local messages are never dropped
        const localCachedContacts = getLocal('contacts', []);
        localCachedContacts.forEach(c => {
          if (!contactMap.has(c.id)) contactMap.set(c.id, c);
        });

        if (contactMap.size > 0) {
          currentContacts = Array.from(contactMap.values());
          currentContacts.sort((a, b) => {
            const dateA = new Date(a.submittedAt || a.createdAt || 0).getTime();
            const dateB = new Date(b.submittedAt || b.createdAt || 0).getTime();
            return dateB - dateA;
          });
          setLocal('contacts', currentContacts);
        }
      } catch (err) {
        console.warn("Contacts sync issue:", err);
      }

      if (statusText) statusText.textContent = 'Firestore: Connected';

      // Attach realtime listeners
      setupRealtimeListeners(db);

    } catch (err) {
      console.warn("Live Firebase fetch error in Admin Console:", err);
      if (statusText) statusText.textContent = 'Firestore: Offline';
    }
  }

  // Update UI with fresh data
  updateAllUIPanels();
}

function renderDashboardActivity() {
  const appsBox = document.getElementById('dashboard-recent-apps');
  const ideasBox = document.getElementById('dashboard-recent-ideas');

  if (appsBox) {
    if (currentApplications.length === 0) {
      appsBox.innerHTML = '<div class="recent-list-empty">No applications received yet.</div>';
    } else {
      appsBox.innerHTML = currentApplications.slice(0, 4).map(app => {
        const name = app.applicantName || app.name || app.fullName || 'Anonymous Candidate';
        const role = app.jobTitle || app.title || app.position || 'General Application';
        const dateStr = formatDateTime(app.submittedAt || app.createdAt);
        const status = app.status || 'New';
        return `
        <div style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 700; color: #ffffff;">${escapeHtml(name)}</div>
            <div style="font-size: 0.8rem; color: #94a3b8;">${escapeHtml(role)} &bull; ${dateStr}</div>
          </div>
          <span class="badge ${status === 'New' ? 'cyan' : 'emerald'}">${status}</span>
        </div>
      `;
      }).join('');
    }
  }

  if (ideasBox) {
    if (currentIdeas.length === 0) {
      ideasBox.innerHTML = '<div class="recent-list-empty">No SaaS ideas submitted yet.</div>';
    } else {
      ideasBox.innerHTML = currentIdeas.slice(0, 4).map(idea => {
        const title = idea.conceptName || idea.title || 'Untitled SaaS Concept';
        const founder = idea.founderName || idea.name || 'Anonymous Founder';
        const dateStr = formatDateTime(idea.submittedAt || idea.createdAt);
        const stage = idea.stage || 'Concept';
        return `
        <div style="padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 700; color: #ffffff;">${escapeHtml(title)}</div>
            <div style="font-size: 0.8rem; color: #94a3b8;">by ${escapeHtml(founder)} &bull; ${dateStr}</div>
          </div>
          <span class="badge amber">${escapeHtml(stage)}</span>
        </div>
      `;
      }).join('');
    }
  }
}

/* ==========================================================================
   PRODUCTS MANAGEMENT (CRUD)
   ========================================================================== */

function renderProductsTable() {
  const tbody = document.getElementById('products-table-body');
  if (currentProducts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #64748b;">No products found.</td></tr>';
    return;
  }

  tbody.innerHTML = currentProducts.map(p => {
    const webSt = p.webStatus || (p.status === 'Live' ? 'Live' : p.status);
    const platformItems = [];
    platformItems.push(`<span style="color: ${webSt === 'Live' ? '#34d399' : '#94a3b8'};">Web: ${escapeHtml(webSt)}</span>`);
    if (p.androidStatus && p.androidStatus !== 'None') {
      platformItems.push(`<span style="color: ${p.androidStatus === 'Live' ? '#34d399' : '#94a3b8'};">Android: ${escapeHtml(p.androidStatus)}</span>`);
    }
    if (p.iosStatus && p.iosStatus !== 'None') {
      platformItems.push(`<span style="color: ${p.iosStatus === 'Live' ? '#34d399' : '#94a3b8'};">iOS: ${escapeHtml(p.iosStatus)}</span>`);
    }
    const platformsHtml = platformItems.join(' &bull; ');

    const links = [];
    if (p.url && p.url !== '#') links.push(`<a href="${escapeHtml(p.url)}" target="_blank" style="color: #38bdf8; text-decoration: none;">Web ↗</a>`);
    if (p.androidUrl && p.androidUrl !== '#') links.push(`<a href="${escapeHtml(p.androidUrl)}" target="_blank" style="color: #34d399; text-decoration: none;">Android ↗</a>`);
    if (p.iosUrl && p.iosUrl !== '#') links.push(`<a href="${escapeHtml(p.iosUrl)}" target="_blank" style="color: #c084fc; text-decoration: none;">iOS ↗</a>`);
    const linksHtml = links.length ? links.join(' &bull; ') : '<span style="color: #64748b;">No links</span>';

    return `
      <tr>
        <td>
          <strong style="color: #ffffff;">${escapeHtml(p.name)}</strong>
          <div style="font-size: 0.78rem; color: #94a3b8;">${escapeHtml(p.tagline || '')}</div>
        </td>
        <td>${escapeHtml(p.category || 'Platform')}</td>
        <td><span class="badge ${p.statusColor || 'cyan'}">${p.status}</span></td>
        <td>
          <div style="font-size: 0.8rem; margin-bottom: 4px;">${platformsHtml}</div>
          <div style="font-size: 0.75rem;">${linksHtml}</div>
        </td>
        <td>
          <button class="btn-table-action" onclick="window.editProduct('${p.id}')">Edit</button>
          <button class="btn-table-action delete" onclick="window.deleteProduct('${p.id}')">Delete</button>
        </td>
      </tr>
    `;
  }).join('');
}

document.getElementById('btn-open-create-product').addEventListener('click', () => {
  document.getElementById('product-form').reset();
  document.getElementById('prod-id').value = '';
  document.getElementById('prod-web-status').value = 'Live';
  document.getElementById('prod-android-status').value = 'Coming Soon';
  document.getElementById('prod-ios-status').value = 'Coming Soon';
  document.getElementById('prod-url').value = '';
  document.getElementById('prod-android-url').value = '';
  document.getElementById('prod-ios-url').value = '';
  document.getElementById('product-modal-title').textContent = 'Add New Product';
  openModal('modal-product');
});

document.getElementById('product-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const idInput = document.getElementById('prod-id').value.trim();
  const id = idInput || `prod-${Date.now()}`;
  const product = {
    id,
    name: document.getElementById('prod-name').value.trim(),
    tagline: document.getElementById('prod-tagline').value.trim(),
    category: document.getElementById('prod-category').value.trim(),
    status: document.getElementById('prod-status').value,
    statusColor: document.getElementById('prod-color').value,
    webStatus: document.getElementById('prod-web-status').value,
    url: document.getElementById('prod-url').value.trim(),
    androidStatus: document.getElementById('prod-android-status').value,
    androidUrl: document.getElementById('prod-android-url').value.trim(),
    iosStatus: document.getElementById('prod-ios-status').value,
    iosUrl: document.getElementById('prod-ios-url').value.trim(),
    description: document.getElementById('prod-desc').value.trim(),
    updatedAt: new Date().toISOString()
  };

  const existingIdx = currentProducts.findIndex(p => p.id === id);
  if (existingIdx >= 0) {
    currentProducts[existingIdx] = product;
  } else {
    currentProducts.push(product);
  }

  setLocal('products', currentProducts);
  closeModal('modal-product');
  renderProductsTable();

  // If live Firebase is configured, persist to Firestore collection
  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(app);
      await setDoc(doc(db, "products", id), product, { merge: true });
    } catch (err) {
      console.warn("Could not sync product to Firestore:", err);
    }
  }
});

window.editProduct = (id) => {
  const p = currentProducts.find(x => x.id === id);
  if (!p) return;
  document.getElementById('prod-id').value = p.id;
  document.getElementById('prod-name').value = p.name;
  document.getElementById('prod-tagline').value = p.tagline || '';
  document.getElementById('prod-category').value = p.category || '';
  document.getElementById('prod-status').value = p.status || 'Live';
  document.getElementById('prod-color').value = p.statusColor || 'cyan';
  document.getElementById('prod-web-status').value = p.webStatus || (p.status === 'Live' ? 'Live' : (p.status || 'Live'));
  document.getElementById('prod-android-status').value = p.androidStatus || (p.androidUrl ? 'Live' : 'Coming Soon');
  document.getElementById('prod-ios-status').value = p.iosStatus || (p.iosUrl ? 'Live' : 'Coming Soon');
  document.getElementById('prod-url').value = (p.url && p.url !== '#') ? p.url : '';
  document.getElementById('prod-android-url').value = (p.androidUrl && p.androidUrl !== '#') ? p.androidUrl : '';
  document.getElementById('prod-ios-url').value = (p.iosUrl && p.iosUrl !== '#') ? p.iosUrl : '';
  document.getElementById('prod-desc').value = p.description || '';
  document.getElementById('product-modal-title').textContent = 'Edit Product';
  openModal('modal-product');
};

window.deleteProduct = async (id) => {
  if (!confirm('Are you sure you want to delete this product?')) return;
  currentProducts = currentProducts.filter(p => p.id !== id);
  setLocal('products', currentProducts);
  renderProductsTable();

  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(app);
      await deleteDoc(doc(db, "products", id));
    } catch (err) {
      console.warn("Could not delete product from Firestore:", err);
    }
  }
};

/* ==========================================================================
   JOBS MANAGEMENT (CRUD)
   ========================================================================== */

function getJobTypeBadge(type) {
  const t = (type || 'Full-Time').toLowerCase();
  if (t.includes('intern')) return '<span class="badge violet">Internship</span>';
  if (t.includes('live') || t.includes('project')) return '<span class="badge amber">Live Project</span>';
  if (t.includes('part')) return '<span class="badge cyan">Part-Time</span>';
  if (t.includes('contract')) return '<span class="badge amber">Contract</span>';
  return '<span class="badge emerald">Full-Time</span>';
}

function renderJobsTable() {
  const tbody = document.getElementById('jobs-table-body');
  if (currentJobs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #64748b;">No jobs posted yet.</td></tr>';
    return;
  }

  tbody.innerHTML = currentJobs.map(j => `
    <tr>
      <td>
        <strong style="color: #ffffff;">${escapeHtml(j.title)}</strong>
        <div style="margin-top: 4px;">${getJobTypeBadge(j.type)}</div>
      </td>
      <td>${escapeHtml(j.department)}</td>
      <td>${escapeHtml(j.location)}</td>
      <td>${escapeHtml(j.experience || 'Experienced')}</td>
      <td><span class="badge ${j.status === 'Active' ? 'emerald' : 'rose'}">${j.status}</span></td>
      <td>
        <button class="btn-table-action" onclick="window.editJob('${j.id}')">Edit</button>
        <button class="btn-table-action delete" onclick="window.deleteJob('${j.id}')">Delete</button>
      </td>
    </tr>
  `).join('');
}

document.getElementById('btn-open-create-job').addEventListener('click', () => {
  document.getElementById('job-form').reset();
  document.getElementById('job-id-input').value = '';
  document.getElementById('job-modal-title').textContent = 'Post New Career Position';
  openModal('modal-job');
});

document.getElementById('job-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const idInput = document.getElementById('job-id-input').value.trim();
  const id = idInput || `job-${Date.now()}`;
  const reqs = document.getElementById('job-reqs-input').value
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  const job = {
    id,
    title: document.getElementById('job-title-input').value.trim(),
    department: document.getElementById('job-dept-input').value.trim(),
    location: document.getElementById('job-location-input').value.trim(),
    type: document.getElementById('job-type-input').value,
    experience: document.getElementById('job-exp-input').value.trim(),
    status: document.getElementById('job-status-input').value,
    description: document.getElementById('job-desc-input').value.trim(),
    requirements: reqs,
    postedAt: new Date().toISOString()
  };

  const existingIdx = currentJobs.findIndex(j => j.id === id);
  if (existingIdx >= 0) {
    currentJobs[existingIdx] = job;
  } else {
    currentJobs.unshift(job);
  }

  setLocal('jobs', currentJobs);
  closeModal('modal-job');
  renderJobsTable();

  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(app);
      await setDoc(doc(db, "jobs", id), job, { merge: true });
    } catch (err) {
      console.warn("Could not sync job to Firestore:", err);
    }
  }
});

window.editJob = (id) => {
  const j = currentJobs.find(x => x.id === id);
  if (!j) return;
  document.getElementById('job-id-input').value = j.id;
  document.getElementById('job-title-input').value = j.title;
  document.getElementById('job-dept-input').value = j.department;
  document.getElementById('job-location-input').value = j.location;
  document.getElementById('job-type-input').value = j.type || 'Full-Time';
  document.getElementById('job-exp-input').value = j.experience || '';
  document.getElementById('job-status-input').value = j.status || 'Active';
  document.getElementById('job-desc-input').value = j.description || '';
  document.getElementById('job-reqs-input').value = (j.requirements || []).join('\n');
  document.getElementById('job-modal-title').textContent = 'Edit Career Position';
  openModal('modal-job');
};

window.deleteJob = async (id) => {
  if (!confirm('Are you sure you want to delete this job posting?')) return;
  currentJobs = currentJobs.filter(j => j.id !== id);
  setLocal('jobs', currentJobs);
  renderJobsTable();

  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(app);
      await deleteDoc(doc(db, "jobs", id));
    } catch (err) {
      console.warn("Could not delete job from Firestore:", err);
    }
  }
};

/* ==========================================================================
   APPLICATIONS INBOX
   ========================================================================== */

function renderApplicationsTable() {
  const tbody = document.getElementById('applications-table-body');
  if (!tbody) return;

  const filterStatusEl = document.getElementById('filter-app-status');
  const filterStatus = filterStatusEl ? filterStatusEl.value : 'all';

  const displayedApps = filterStatus === 'all'
    ? currentApplications
    : currentApplications.filter(a => (a.status || 'New') === filterStatus);

  if (displayedApps.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #64748b; padding: 24px;">${currentApplications.length === 0 ? 'No applications received yet.' : 'No applications found with status "' + escapeHtml(filterStatus) + '".'}</td></tr>`;
    return;
  }

  tbody.innerHTML = displayedApps.map(app => {
    const applicantName = app.applicantName || app.name || app.fullName || 'Anonymous Candidate';
    const jobTitle = app.jobTitle || app.title || app.position || app.role || 'General Application';
    const email = app.applicantEmail || app.email || 'N/A';
    const phone = app.applicantPhone || app.phone || app.mobile || 'N/A';
    const resume = app.resumeUrl || app.resume || '';
    const status = app.status || 'New';
    const dateStr = formatDateTime(app.submittedAt || app.createdAt);

    return `
    <tr>
      <td><strong style="color: #ffffff;">${escapeHtml(applicantName)}</strong></td>
      <td>${escapeHtml(jobTitle)}</td>
      <td>
        <div>${escapeHtml(email)}</div>
        <div style="font-size: 0.78rem; color: #94a3b8;">${escapeHtml(phone)}</div>
      </td>
      <td>
        ${resume ? `<a href="${escapeHtml(resume)}" target="_blank" style="color: #38bdf8; text-decoration: underline;">View Resume ↗</a>` : '<span style="color: #64748b;">No file</span>'}
      </td>
      <td style="font-size: 0.8rem; color: #94a3b8;">${dateStr}</td>
      <td>
        <select class="form-select-sm" onchange="window.updateAppStatus('${app.id}', this.value)">
          <option value="New" ${status === 'New' ? 'selected' : ''}>New</option>
          <option value="Reviewing" ${status === 'Reviewing' ? 'selected' : ''}>Reviewing</option>
          <option value="Shortlisted" ${status === 'Shortlisted' ? 'selected' : ''}>Shortlisted</option>
          <option value="Rejected" ${status === 'Rejected' ? 'selected' : ''}>Rejected</option>
        </select>
      </td>
      <td>
        <button class="btn-table-action" onclick="window.viewApplication('${app.id}')">View Note</button>
      </td>
    </tr>
  `;
  }).join('');
}

// Bind Application status filter
const filterAppStatusSelect = document.getElementById('filter-app-status');
if (filterAppStatusSelect) {
  filterAppStatusSelect.addEventListener('change', () => {
    renderApplicationsTable();
  });
}

window.updateAppStatus = async (id, newStatus) => {
  const app = currentApplications.find(a => a.id === id);
  if (app) {
    app.status = newStatus;
    setLocal('applications', currentApplications);
    renderDashboardActivity();
    renderApplicationsTable();

    if (isFirebaseConfigured()) {
      try {
        const { getFirestore, doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
        const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
        const fbApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
        const db = getFirestore(fbApp);
        await updateDoc(doc(db, "job_applications", id), { status: newStatus });
      } catch (e) {
        console.warn("Could not sync application status update to Firestore:", e);
      }
    }
  }
};

window.viewApplication = (id) => {
  const app = currentApplications.find(a => a.id === id);
  if (!app) return;

  const applicantName = app.applicantName || app.name || app.fullName || 'Anonymous Candidate';
  const jobTitle = app.jobTitle || app.title || app.position || app.role || 'General Application';
  const email = app.applicantEmail || app.email || 'N/A';
  const phone = app.applicantPhone || app.phone || app.mobile || 'Not provided';
  const portfolio = app.portfolioUrl || app.portfolio || app.link || '';
  const note = app.notes || app.note || app.coverLetter || 'No note provided.';
  const resume = app.resumeUrl || app.resume || '';

  const body = document.getElementById('view-app-body');
  body.innerHTML = `
    <div style="margin-bottom: 16px;">
      <h4 style="color: #ffffff; font-size: 1.15rem; margin-bottom: 4px;">${escapeHtml(applicantName)}</h4>
      <div style="color: #38bdf8; font-size: 0.88rem;">Applying for: ${escapeHtml(jobTitle)}</div>
    </div>
    <p><strong>Email:</strong> ${email !== 'N/A' ? `<a href="mailto:${escapeHtml(email)}" style="color: #38bdf8;">${escapeHtml(email)}</a>` : 'N/A'}</p>
    <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
    <p><strong>Portfolio / Profile:</strong> ${portfolio ? `<a href="${escapeHtml(portfolio)}" target="_blank" style="color: #38bdf8;">${escapeHtml(portfolio)} ↗</a>` : '<span style="color: #94a3b8;">None provided</span>'}</p>
    <p style="margin-top: 14px;"><strong>Applicant Cover Note:</strong></p>
    <div style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 12px; margin-top: 6px; font-style: italic; color: #cbd5e1;">
      "${escapeHtml(note)}"
    </div>
    ${resume ? `
    <div style="margin-top: 20px;">
      <a href="${escapeHtml(resume)}" target="_blank" class="btn-primary-action" style="display: inline-block; text-decoration: none;">Download / Open Resume Document ↗</a>
    </div>
    ` : ''}
  `;
  openModal('modal-view-app');
};

/* ==========================================================================
   SAAS IDEA PITCHES INBOX
   ========================================================================== */

function renderIdeasTable() {
  const tbody = document.getElementById('ideas-table-body');
  if (currentIdeas.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #64748b;">No SaaS ideas submitted yet.</td></tr>';
    return;
  }

  tbody.innerHTML = currentIdeas.map(idea => `
    <tr>
      <td><strong style="color: #ffffff;">${escapeHtml(idea.conceptName)}</strong></td>
      <td>
        <div>${escapeHtml(idea.founderName)}</div>
        <div style="font-size: 0.78rem; color: #94a3b8;">${escapeHtml(idea.founderEmail)}</div>
      </td>
      <td><span class="badge amber">${idea.stage}</span></td>
      <td style="max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(idea.elevatorPitch || '')}</td>
      <td style="font-size: 0.8rem; color: #94a3b8;">${formatDateTime(idea.submittedAt || idea.createdAt)}</td>
      <td>
        <button class="btn-table-action" onclick="window.viewIdea('${idea.id}')">View Pitch</button>
      </td>
    </tr>
  `).join('');
}

window.viewIdea = (id) => {
  const idea = currentIdeas.find(i => i.id === id);
  if (!idea) return;
  const body = document.getElementById('view-idea-body');
  body.innerHTML = `
    <h4 style="color: #ffffff; font-size: 1.25rem; margin-bottom: 4px;">${escapeHtml(idea.conceptName)}</h4>
    <div style="color: #38bdf8; font-size: 0.88rem; margin-bottom: 16px;">
      Founder: ${escapeHtml(idea.founderName)} &bull; <a href="mailto:${idea.founderEmail}" style="color: #38bdf8;">${escapeHtml(idea.founderEmail)}</a>
      ${idea.background ? `<div style="font-size: 0.8rem; color: #94a3b8; margin-top: 2px;">Background: ${escapeHtml(idea.background)}</div>` : ''}
    </div>
    
    <div style="display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap;">
      <span class="badge amber">Stage: ${escapeHtml(idea.stage || 'Concept')}</span>
      ${idea.productType ? `<span class="badge cyan">Type: ${escapeHtml(idea.productType)}</span>` : ''}
      <span class="badge emerald">Terms Agreed: ✓</span>
    </div>

    <p style="margin-top: 10px;"><strong>Core Problem:</strong><br />${escapeHtml(idea.problem)}</p>
    <p style="margin-top: 10px;"><strong>Proposed Solution:</strong><br />${escapeHtml(idea.solution)}</p>
    ${idea.targetAudience ? `<p style="margin-top: 10px;"><strong>Target Audience / Users:</strong><br />${escapeHtml(idea.targetAudience)}</p>` : ''}
    ${idea.successReason ? `<p style="margin-top: 10px;"><strong>Why it could succeed (Potential):</strong><br />${escapeHtml(idea.successReason)}</p>` : ''}
    ${idea.additionalContext ? `<p style="margin-top: 10px;"><strong>Additional Context / Links:</strong><br />${escapeHtml(idea.additionalContext)}</p>` : ''}
    ${idea.deckUrl ? `<p style="margin-top: 14px;"><strong>Deck / Prototype:</strong> <a href="${idea.deckUrl}" target="_blank" style="color: #38bdf8;">${escapeHtml(idea.deckUrl)} ↗</a></p>` : ''}
    
    <div style="margin-top: 24px;">
      <a href="mailto:${idea.founderEmail}?subject=Re:%20Synerbit%20Incubation%20Proposal%20-%20${encodeURIComponent(idea.conceptName)}" class="btn-primary-action" style="display: inline-block; text-decoration: none;">Reply to Founder via Email ✉️</a>
    </div>
  `;
  openModal('modal-view-idea');
};

/* ==========================================================================
   CONTACT MESSAGES
   ========================================================================== */

function renderContactsTable() {
  const tbody = document.getElementById('contacts-table-body');
  if (currentContacts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 32px 16px;">No contact messages yet.</td></tr>';
    return;
  }

  tbody.innerHTML = currentContacts.map(c => `
    <tr>
      <td><strong style="color: #ffffff;">${escapeHtml(c.name || 'Anonymous')}</strong></td>
      <td><a href="mailto:${escapeHtml(c.email)}" style="color: #38bdf8; text-decoration: underline;" title="Reply to ${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></td>
      <td><span style="font-weight: 600; color: #cbd5e1;">${escapeHtml(c.subject || 'General Inquiry')}</span></td>
      <td style="max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #e2e8f0;" title="${escapeHtml(c.message)}">${escapeHtml(c.message)}</td>
      <td style="font-size: 0.8rem; color: #94a3b8; white-space: nowrap;">${formatDateTime(c.submittedAt || c.createdAt)}</td>
      <td style="white-space: nowrap;">
        <button class="btn-table-action" onclick="window.viewContact('${c.id}')">View</button>
        <a href="mailto:${encodeURIComponent(c.email)}?subject=Re:%20${encodeURIComponent(c.subject || 'Synerbit Inquiry')}" class="btn-table-action" style="text-decoration: none; display: inline-block;">Reply ✉️</a>
        <button class="btn-table-action" style="color: #f87171;" onclick="window.deleteContact('${c.id}')" title="Delete">✕</button>
      </td>
    </tr>
  `).join('');
}

window.viewContact = (id) => {
  const contact = currentContacts.find(c => c.id === id);
  if (!contact) return;
  const body = document.getElementById('view-contact-body');
  if (body) {
    body.innerHTML = `
      <div style="border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px; margin-bottom: 16px;">
        <h4 style="color: #ffffff; font-size: 1.25rem; margin-bottom: 4px;">${escapeHtml(contact.name || 'Anonymous')}</h4>
        <div style="color: #38bdf8; font-size: 0.88rem;">
          <a href="mailto:${escapeHtml(contact.email)}" style="color: #38bdf8; text-decoration: underline;">${escapeHtml(contact.email)}</a>
          &bull; <span style="color: #94a3b8;">${formatDateTime(contact.submittedAt || contact.createdAt)}</span>
        </div>
      </div>
      
      <p style="margin-bottom: 8px;"><strong>Subject:</strong> <span style="color: #ffffff;">${escapeHtml(contact.subject || 'General Inquiry')}</span></p>
      <p style="margin-bottom: 6px;"><strong>Message Content:</strong></p>
      <div style="background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 14px; line-height: 1.6; color: #e2e8f0; white-space: pre-wrap; font-size: 0.95rem;">${escapeHtml(contact.message)}</div>
      
      <div style="margin-top: 24px; display: flex; gap: 10px; justify-content: flex-end;">
        <button type="button" class="btn-table-action" style="color: #f87171;" onclick="window.deleteContact('${contact.id}'); window.closeModal('modal-view-contact');">Delete Message</button>
        <a href="mailto:${encodeURIComponent(contact.email)}?subject=Re:%20${encodeURIComponent(contact.subject || 'Synerbit Inquiry')}" class="btn-primary-action" style="display: inline-block; text-decoration: none;">Reply via Email ✉️</a>
      </div>
    `;
    openModal('modal-view-contact');
  }
};

window.deleteContact = async (id) => {
  if (!confirm('Are you sure you want to delete this contact message?')) return;
  
  currentContacts = currentContacts.filter(c => c.id !== id);
  setLocal('contacts', currentContacts);
  updateAllUIPanels();

  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(app);
      await deleteDoc(doc(db, "contact_messages", id));
      try {
        await deleteDoc(doc(db, "contacts", id));
      } catch (_) {}
    } catch (err) {
      console.warn("Delete contact Firestore error:", err);
    }
  }
};

/* ==========================================================================
   TEAM & GRANULAR ROLE-BASED ACCESS (SUPER ADMIN)
   ========================================================================== */

function renderTeamTable() {
  const tbody = document.getElementById('team-table-body');
  if (currentTeam.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #64748b;">No team members found.</td></tr>';
    return;
  }

  tbody.innerHTML = currentTeam.map(member => {
    const p = member.permissions || {};
    const permsList = [
      p.products ? '<span class="badge cyan">Products</span>' : '',
      p.jobs ? '<span class="badge emerald">Jobs</span>' : '',
      p.applications ? '<span class="badge cyan">Applications</span>' : '',
      p.ideas ? '<span class="badge amber">Ideas</span>' : '',
      p.contacts ? '<span class="badge emerald">Contacts</span>' : '',
      member.isSuperAdmin ? '<span class="badge rose">Super Admin</span>' : ''
    ].filter(Boolean).join(' ');

    return `
      <tr>
        <td><strong style="color: #ffffff;">${escapeHtml(member.name)}</strong></td>
        <td>${escapeHtml(member.email)}</td>
        <td>${escapeHtml(member.role)}</td>
        <td>${permsList || '<span style="color: #64748b;">No permissions</span>'}</td>
        <td>
          ${member.isSuperAdmin ? '<span style="color: #64748b; font-size: 0.78rem;">Protected</span>' : `
            <button class="btn-table-action" onclick="window.editMember('${member.id}')">Edit Permissions</button>
            <button class="btn-table-action delete" onclick="window.deleteMember('${member.id}')">Remove</button>
          `}
        </td>
      </tr>
    `;
  }).join('');
}

document.getElementById('btn-open-add-member').addEventListener('click', () => {
  document.getElementById('team-form').reset();
  document.getElementById('team-user-id').value = '';
  document.getElementById('team-modal-title').textContent = 'Add Team Member & Assign Access';
  openModal('modal-team');
});

document.getElementById('team-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('team-user-id').value || `member-${Date.now()}`;
  const member = {
    id,
    name: document.getElementById('team-user-name').value.trim(),
    email: document.getElementById('team-user-email').value.trim(),
    role: document.getElementById('team-user-role').value.trim(),
    isSuperAdmin: false,
    permissions: {
      products: document.getElementById('perm-products').checked,
      jobs: document.getElementById('perm-jobs').checked,
      applications: document.getElementById('perm-applications').checked,
      ideas: document.getElementById('perm-ideas').checked,
      contacts: document.getElementById('perm-contacts').checked,
      team: false
    },
    createdAt: new Date().toISOString()
  };

  const existingIdx = currentTeam.findIndex(m => m.id === id);
  if (existingIdx >= 0) {
    currentTeam[existingIdx] = member;
  } else {
    currentTeam.push(member);
  }

  setLocal('team', currentTeam);
  closeModal('modal-team');
  renderTeamTable();
});

window.editMember = (id) => {
  const m = currentTeam.find(x => x.id === id);
  if (!m) return;
  document.getElementById('team-user-id').value = m.id;
  document.getElementById('team-user-name').value = m.name;
  document.getElementById('team-user-email').value = m.email;
  document.getElementById('team-user-role').value = m.role;
  const p = m.permissions || {};
  document.getElementById('perm-products').checked = !!p.products;
  document.getElementById('perm-jobs').checked = !!p.jobs;
  document.getElementById('perm-applications').checked = !!p.applications;
  document.getElementById('perm-ideas').checked = !!p.ideas;
  document.getElementById('perm-contacts').checked = !!p.contacts;
  document.getElementById('team-modal-title').textContent = 'Edit Member Permissions';
  openModal('modal-team');
};

window.deleteMember = (id) => {
  if (!confirm('Are you sure you want to remove this team member?')) return;
  currentTeam = currentTeam.filter(m => m.id !== id);
  setLocal('team', currentTeam);
  renderTeamTable();
};

/* ==========================================================================
   MODAL UTILITIES
   ========================================================================== */

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}
window.closeModal = closeModal;

// Cross-tab synchronization
window.addEventListener('storage', (e) => {
  if (e.key === 'synerbit_contacts') {
    currentContacts = getLocal('contacts', []);
    updateAllUIPanels();
  } else if (e.key === 'synerbit_applications') {
    currentApplications = getLocal('applications', []);
    updateAllUIPanels();
  } else if (e.key === 'synerbit_ideas') {
    currentIdeas = getLocal('ideas', []);
    updateAllUIPanels();
  }
});

document.querySelectorAll('[data-close-modal]').forEach(btn => {
  btn.addEventListener('click', () => {
    closeModal(btn.dataset.closeModal);
  });
});

document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.classList.remove('active');
  });
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Bind Manual Sync Button
const syncBtn = document.getElementById('btn-sync-firebase');
if (syncBtn) {
  syncBtn.addEventListener('click', async () => {
    syncBtn.classList.add('syncing');
    const label = syncBtn.querySelector('span');
    if (label) label.textContent = 'Syncing...';
    try {
      await loadAllData();
    } finally {
      setTimeout(() => {
        syncBtn.classList.remove('syncing');
        if (label) label.textContent = 'Sync with Firebase';
      }, 500);
    }
  });
}

// Bootstrap Console
initAuth();
