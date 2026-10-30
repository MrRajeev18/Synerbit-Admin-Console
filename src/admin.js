/**
 * Synerbit Admin Console Engine
 * Includes Role-Based Access Control (RBAC), Firebase Integration,
 * and CRUD operations for Products, Jobs, Applications, and Ideas.
 */

import { firebaseConfig, isFirebaseConfigured, DEFAULT_PRODUCTS, DEFAULT_JOBS } from './firebase.js';

// Local storage data caching disabled — all data strictly from live Firebase backend
const getLocal = (_key, fallback = []) => fallback;
const setLocal = () => {};

// Purge any legacy business data cached in localStorage
['synerbit_applications', 'synerbit_deleted_applications', 'synerbit_ideas', 'synerbit_contacts', 'synerbit_products', 'synerbit_jobs', 'synerbit_team'].forEach(k => {
  try { localStorage.removeItem(k); } catch (_) {}
});

// Permanent Super Admin definitions (Fixed, Immutable, & Protected)
const SUPER_ADMIN_EMAILS = ['rajeev@synerbit.in', 'admin@synerbit.in'];

const isSuperAdminEmail = (email) => {
  return SUPER_ADMIN_EMAILS.includes((email || '').toLowerCase().trim());
};

const PERMANENT_SUPER_ADMINS = [
  {
    id: 'admin-super-rajeev',
    name: 'Rajeev Ranjan',
    email: 'rajeev@synerbit.in',
    role: 'Super Admin',
    isSuperAdmin: true,
    permissions: {
      products: true,
      jobs: true,
      applications: true,
      ideas: true,
      contacts: true,
      team: true
    },
    createdAt: new Date("2026-01-01").toISOString()
  },
  {
    id: 'admin-super-synerbit',
    name: 'Synerbit Administrator',
    email: 'admin@synerbit.in',
    role: 'Super Admin',
    isSuperAdmin: true,
    permissions: {
      products: true,
      jobs: true,
      applications: true,
      ideas: true,
      contacts: true,
      team: true
    },
    createdAt: new Date("2026-01-01").toISOString()
  }
];

const DEFAULT_SUPER_ADMIN = PERMANENT_SUPER_ADMINS[0];

// Team deduplication helper to ensure no duplicate email records in state or UI
function deduplicateTeam(teamList) {
  if (!Array.isArray(teamList)) return [];
  const map = new Map();
  for (const m of teamList) {
    const emailKey = (m.email || '').toLowerCase().trim();
    if (!emailKey) continue;
    if (!map.has(emailKey)) {
      map.set(emailKey, m);
    } else {
      const existing = map.get(emailKey);
      const existingIsPreset = existing.id && existing.id.startsWith('admin-');
      const mIsPreset = m.id && m.id.startsWith('admin-');
      if (existingIsPreset && !mIsPreset) {
        map.set(emailKey, { ...existing, ...m });
      } else if (!existingIsPreset && mIsPreset) {
        map.set(emailKey, { ...m, ...existing });
      } else {
        const dateA = new Date(existing.createdAt || existing.updatedAt || 0).getTime();
        const dateB = new Date(m.createdAt || m.updatedAt || 0).getTime();
        map.set(emailKey, dateB >= dateA ? { ...existing, ...m } : { ...m, ...existing });
      }
    }
  }
  return Array.from(map.values());
}

// State
let currentUser = null;
let currentProducts = [...DEFAULT_PRODUCTS];
let currentJobs = [...DEFAULT_JOBS];
let currentApplications = [];
let currentDeletedApplications = [];
let currentAppView = 'active'; // 'active' | 'trash'
let selectedAppIds = new Set();
let currentIdeas = [];
let currentContacts = [];
let currentTeam = [];
let isSigningIn = false;

// DOM Elements
const authScreen = document.getElementById('auth-screen');
const adminApp = document.getElementById('admin-app');
const loginForm = document.getElementById('admin-login-form');
const authError = document.getElementById('auth-error-msg');
const authStatus = document.getElementById('auth-status-msg');
const logoutBtn = document.getElementById('btn-admin-logout');

function showAuthStatus(message, isSuccess = false) {
  const statusEl = document.getElementById('auth-status-msg');
  if (!statusEl) return;
  statusEl.className = `auth-status-banner ${isSuccess ? 'status-success' : ''}`;
  statusEl.innerHTML = isSuccess 
    ? `<span style="font-size: 1.1rem; line-height: 1;">✓</span> <span>${escapeHtml(message)}</span>` 
    : `<span class="auth-status-spinner"></span> <span>${escapeHtml(message)}</span>`;
  statusEl.style.display = 'flex';
  const errEl = document.getElementById('auth-error-msg');
  if (errEl) errEl.style.display = 'none';
}

function hideAuthStatus() {
  const statusEl = document.getElementById('auth-status-msg');
  if (statusEl) statusEl.style.display = 'none';
}

function showAuthError(message) {
  hideAuthStatus();
  const errEl = document.getElementById('auth-error-msg');
  if (errEl) {
    errEl.textContent = message;
    errEl.style.display = 'block';
  }
}

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

  // Show / Hide Password toggle for Login Screen
  const btnTogglePassword = document.getElementById('btn-toggle-password');
  const loginPasswordInput = document.getElementById('login-password');
  if (btnTogglePassword && loginPasswordInput) {
    btnTogglePassword.addEventListener('click', () => {
      const isPwd = loginPasswordInput.getAttribute('type') === 'password';
      loginPasswordInput.setAttribute('type', isPwd ? 'text' : 'password');
      const eyeShow = document.getElementById('eye-icon-show');
      const eyeHide = document.getElementById('eye-icon-hide');
      if (eyeShow && eyeHide) {
        eyeShow.style.display = isPwd ? 'none' : 'block';
        eyeHide.style.display = isPwd ? 'block' : 'none';
      }
    });
  }

  // Show / Hide Password toggle for Team Modal
  const btnToggleTeamPassword = document.getElementById('btn-toggle-team-password');
  const teamPasswordInput = document.getElementById('team-user-password');
  if (btnToggleTeamPassword && teamPasswordInput) {
    btnToggleTeamPassword.addEventListener('click', () => {
      const isPwd = teamPasswordInput.getAttribute('type') === 'password';
      teamPasswordInput.setAttribute('type', isPwd ? 'text' : 'password');
      const eyeShow = document.getElementById('eye-icon-team-show');
      const eyeHide = document.getElementById('eye-icon-team-hide');
      if (eyeShow && eyeHide) {
        eyeShow.style.display = isPwd ? 'none' : 'block';
        eyeHide.style.display = isPwd ? 'block' : 'none';
      }
    });
  }

  // Handle Login Form Submit (Strict Firebase Authentication Only)
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value.trim();

      if (authError) authError.style.display = 'none';
      hideAuthStatus();

      if (!email || !password) {
        showAuthError('Please enter both your admin email and password.');
        return;
      }

      const btnSubmit = document.getElementById('btn-login-submit');
      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.textContent = 'Verifying credentials...';
      }

      showAuthStatus('Checking account credentials in backend...');
      isSigningIn = true;

      try {
        const { getAuth, signInWithEmailAndPassword, setPersistence, browserSessionPersistence } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
        const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
        const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
        const auth = getAuth(app);

        // Enforce session persistence so closing tab/browser clears the login session
        try {
          await setPersistence(auth, browserSessionPersistence);
        } catch (_) {}

        const normEmail = email.toLowerCase().trim();

        // 1. Check if the user exists in Firestore team collection or is permanent Super Admin
        const { getFirestore, collection, getDocs, doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
        const db = getFirestore(app);

        let teamSnap = null;
        try {
          teamSnap = await getDocs(collection(db, "team"));
        } catch (fsErr) {
          console.warn("Could not query Firestore team:", fsErr);
        }

        const teamList = teamSnap ? teamSnap.docs.map(d => ({ id: d.id, ...d.data() })) : [];
        const preAuthMember = teamList.find(m => (m.email || '').toLowerCase().trim() === normEmail);
        const isSuper = isSuperAdminEmail(normEmail);
        const existsInFirestoreBackend = !!preAuthMember || isSuper;

        let userCred = null;
        let signInError = null;

        try {
          userCred = await signInWithEmailAndPassword(auth, email, password);
        } catch (err) {
          signInError = err;
        }

        if (userCred) {
          // Firebase Auth credentials matched!
          // Now verify whether account has permissions in the console backend
          showAuthStatus('Validating module permissions...');
          const authorized = await resolveUserPermissions(userCred.user.email, userCred.user, true);
          if (!authorized) {
            // No email user ID exists in the console backend
            showAuthError('No data found');
            await handleSignOut();
            return;
          }
          showAuthStatus('Login successful! Loading dashboard...', true);
          return;
        }

        // If signInWithEmailAndPassword failed:
        if (signInError) {
          const errCode = signInError.code || '';

          if (errCode === 'auth/wrong-password') {
            showAuthError('The password is wrong');
            return;
          }

          if (errCode === 'auth/user-not-found') {
            // User does not exist in Firebase Auth
            if (existsInFirestoreBackend) {
              // Pre-authorized in Firestore; auto-provision Auth user
              showAuthStatus('Activating new team account credentials...');
              const { createUserWithEmailAndPassword } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
              try {
                userCred = await createUserWithEmailAndPassword(auth, email, password);
                if (preAuthMember && preAuthMember.id !== userCred.user.uid) {
                  try {
                    await setDoc(doc(db, "team", userCred.user.uid), { ...preAuthMember, id: userCred.user.uid, updatedAt: new Date().toISOString() }, { merge: true });
                  } catch (_) {}
                }
                showAuthStatus('Login successful! Loading dashboard...', true);
                await resolveUserPermissions(userCred.user.email, userCred.user, true);
                return;
              } catch (createErr) {
                if (createErr.code === 'auth/email-already-in-use') {
                  showAuthError('The password is wrong');
                  return;
                }
                throw createErr;
              }
            } else {
              showAuthError('No data found');
              return;
            }
          }

          if (errCode === 'auth/invalid-credential') {
            // Check if user exists in Firestore backend
            if (existsInFirestoreBackend) {
              // Try auto-provisioning in case it's a first-time pre-authorized user
              try {
                const { createUserWithEmailAndPassword } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
                userCred = await createUserWithEmailAndPassword(auth, email, password);
                if (preAuthMember && preAuthMember.id !== userCred.user.uid) {
                  try {
                    await setDoc(doc(db, "team", userCred.user.uid), { ...preAuthMember, id: userCred.user.uid, updatedAt: new Date().toISOString() }, { merge: true });
                  } catch (_) {}
                }
                showAuthStatus('Login successful! Loading dashboard...', true);
                await resolveUserPermissions(userCred.user.email, userCred.user, true);
                return;
              } catch (createErr) {
                // If email already in use, password was wrong
                showAuthError('The password is wrong');
                return;
              }
            } else {
              // Not in Firestore backend. Probe Firebase Auth to see if email exists in Auth at all
              let existsInAuth = false;
              try {
                const { initializeApp: initProbeApp, deleteApp: delProbeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
                const { getAuth: getProbeAuth, createUserWithEmailAndPassword: createProbeUser } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
                const pAppName = `probe-${Date.now()}`;
                const pApp = initProbeApp(firebaseConfig, pAppName);
                const pAuth = getProbeAuth(pApp);
                try {
                  const probeCred = await createProbeUser(pAuth, email, "ProbeCheckPassword123!");
                  try { await probeCred.user.delete(); } catch (_) {}
                  existsInAuth = false;
                } catch (pErr) {
                  if (pErr.code === 'auth/email-already-in-use') {
                    existsInAuth = true;
                  }
                } finally {
                  await delProbeApp(pApp);
                }
              } catch (_) {}

              if (!existsInAuth) {
                showAuthError('No data found');
                return;
              } else {
                // User is in Firebase Auth but has no entry in the console backend
                showAuthError('No data found');
                return;
              }
            }
          }

          if (errCode === 'auth/too-many-requests') {
            showAuthError('Too many failed attempts. Please try again later.');
            return;
          }

          if (errCode === 'auth/network-request-failed') {
            showAuthError('Network error connecting to Firebase. Check internet connection.');
            return;
          }

          // Fallback
          showAuthError(signInError.message || 'The password is wrong');
        }
      } catch (err) {
        console.error('Firebase Auth error:', err);
        showAuthError(err.message || 'Firebase login failed');
      } finally {
        isSigningIn = false;
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.textContent = 'Sign In to Console';
        }
      }
    });
  }

  // Check stored session on startup (only valid within same browser tab session)
  const storedSession = sessionStorage.getItem('synerbit_admin_session');
  if (storedSession) {
    try {
      currentUser = JSON.parse(storedSession);
      enterAdminApp();
    } catch (e) {
      sessionStorage.removeItem('synerbit_admin_session');
      currentUser = null;
    }
  }

  // Monitor Firebase Auth state change for token renewal and live reconnect
  if (isFirebaseConfigured()) {
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js").then(({ getAuth, onAuthStateChanged }) => {
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js").then(({ initializeApp, getApps }) => {
        const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
        const auth = getAuth(app);
        onAuthStateChanged(auth, async (fbUser) => {
          // If a manual sign-in is currently processing in loginForm, do not interfere
          if (isSigningIn) return;

          // If user is sitting on the login screen, DO NOT auto-login to dashboard!
          if (!currentUser) return;

          if (fbUser) {
            console.log("Firebase Auth active user confirmed:", fbUser.email);
            // Verify if user account was deleted or disabled in Firebase Auth backend
            try {
              await fbUser.reload();
            } catch (err) {
              if (err.code === 'auth/user-not-found' || err.code === 'auth/user-disabled') {
                console.warn("User account deleted or disabled in Firebase Auth backend:", err);
                await handleSignOut();
                showAuthError('No data found');
                return;
              }
            }

            // Verify authorization in Firestore team collection
            const isAuthorized = await resolveUserPermissions(fbUser.email, fbUser, false);
            if (!isAuthorized) {
              console.warn("User has no profile in Firestore team. Signing out.");
              await handleSignOut();
              showAuthError('No data found');
            } else if (adminApp.style.display !== 'none') {
              loadAllData();
            }
          } else {
            // Firebase Auth has no active user
            if (currentUser && !isSigningIn) {
              console.warn("No active Firebase Auth user session. Signing out.");
              handleSignOut();
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
  hideAuthStatus();

  realtimeUnsubscribes.forEach(unsub => {
    try { if (typeof unsub === 'function') unsub(); } catch (_) {}
  });
  realtimeUnsubscribes = [];

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
  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  if (emailInput) emailInput.value = '';
  if (passwordInput) passwordInput.value = '';
}

async function resolveUserPermissions(email, fbUser = null, isManualLogin = false) {
  const normEmail = (email || '').toLowerCase().trim();
  let found = null;

  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, collection, getDocs, getDocsFromServer, doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(app);

      // 1. Fetch live team members directly from Firestore server (bypassing browser cache)
      let allTeamSnap;
      try {
        allTeamSnap = await getDocsFromServer(collection(db, "team"));
      } catch (_) {
        allTeamSnap = await getDocs(collection(db, "team"));
      }
      currentTeam = allTeamSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      try { localStorage.removeItem('synerbit_team'); } catch (_) {}

      // 2. Locate member by email or UID
      found = currentTeam.find(m => (m.email || '').toLowerCase().trim() === normEmail);
      if (!found && fbUser && fbUser.uid) {
        found = currentTeam.find(m => m.id === fbUser.uid);
      }

      // 3. Super Admins (rajeev@synerbit.in & admin@synerbit.in) are permanent and always guaranteed Super Admin access
      if (isSuperAdminEmail(normEmail)) {
        const adminPreset = PERMANENT_SUPER_ADMINS.find(a => a.email === normEmail);
        const superAdminRecord = {
          id: fbUser?.uid || found?.id || adminPreset?.id || `admin-${Date.now()}`,
          name: fbUser?.displayName || found?.name || adminPreset?.name || (normEmail === 'rajeev@synerbit.in' ? 'Rajeev Ranjan' : 'Synerbit Administrator'),
          email: normEmail,
          role: 'Super Admin',
          isSuperAdmin: true,
          permissions: {
            products: true,
            jobs: true,
            applications: true,
            ideas: true,
            contacts: true,
            team: true
          },
          createdAt: found?.createdAt || adminPreset?.createdAt || new Date().toISOString()
        };
        try {
          await setDoc(doc(db, "team", superAdminRecord.id), superAdminRecord, { merge: true });
        } catch (_) {}
        // Clean up duplicate Firestore documents for this email if multiple doc IDs exist
        const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
        for (const docItem of currentTeam) {
          if ((docItem.email || '').toLowerCase().trim() === normEmail && docItem.id !== superAdminRecord.id) {
            try {
              await deleteDoc(doc(db, "team", docItem.id));
              console.log("Deleted duplicate Super Admin doc from Firestore:", docItem.id);
            } catch (_) {}
          }
        }
        found = superAdminRecord;
        currentTeam = deduplicateTeam([superAdminRecord, ...currentTeam.filter(m => (m.email || '').toLowerCase().trim() !== normEmail)]);
      }
    } catch (err) {
      console.warn("Could not query Firestore for user profile:", err);
    }
  } else {
    // Offline emergency fallback only when Firebase is completely unconfigured
    let team = getLocal('team', []);
    found = team.find(m => (m.email || '').toLowerCase().trim() === normEmail);
    if (!found && isSuperAdminEmail(normEmail)) {
      found = PERMANENT_SUPER_ADMINS.find(a => a.email === normEmail) || DEFAULT_SUPER_ADMIN;
    }
  }

  if (found) {
    if (isManualLogin || currentUser) {
      loginUser(found);
    }
    return true;
  } else {
    return false;
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

function hasPermission(moduleName) {
  if (!currentUser) return false;
  if (currentUser.isSuperAdmin === true) return true;
  const p = currentUser.permissions || {};
  return !!p[moduleName];
}

/**
 * Dynamically hide / show sidebar tabs and dashboard sections based on the user's permissions
 */
function enforcePermissions() {
  const isSuper = currentUser?.isSuperAdmin === true;

  // Sidebar navigation tabs
  const tabProducts = document.getElementById('tab-btn-products');
  const tabJobs = document.getElementById('tab-btn-jobs');
  const tabApps = document.getElementById('tab-btn-applications');
  const tabIdeas = document.getElementById('tab-btn-ideas');
  const tabContacts = document.getElementById('tab-btn-contacts');
  const teamSection = document.getElementById('section-admin-only');
  const tabTeam = document.getElementById('tab-btn-team');

  if (tabProducts) tabProducts.style.display = hasPermission('products') ? 'flex' : 'none';
  if (tabJobs) tabJobs.style.display = hasPermission('jobs') ? 'flex' : 'none';
  if (tabApps) tabApps.style.display = hasPermission('applications') ? 'flex' : 'none';
  if (tabIdeas) tabIdeas.style.display = hasPermission('ideas') ? 'flex' : 'none';
  if (tabContacts) tabContacts.style.display = hasPermission('contacts') ? 'flex' : 'none';
  if (tabTeam) tabTeam.style.display = (hasPermission('team') || isSuper) ? 'flex' : 'none';
  if (teamSection) teamSection.style.display = (hasPermission('team') || isSuper) ? 'block' : 'none';

  // Dashboard KPI cards
  const kpiProducts = document.getElementById('kpi-card-products');
  const kpiJobs = document.getElementById('kpi-card-jobs');
  const kpiApps = document.getElementById('kpi-card-apps');
  const kpiIdeas = document.getElementById('kpi-card-ideas');
  const kpiContacts = document.getElementById('kpi-card-contacts');

  if (kpiProducts) kpiProducts.style.display = hasPermission('products') ? 'block' : 'none';
  if (kpiJobs) kpiJobs.style.display = hasPermission('jobs') ? 'block' : 'none';
  if (kpiApps) kpiApps.style.display = hasPermission('applications') ? 'block' : 'none';
  if (kpiIdeas) kpiIdeas.style.display = hasPermission('ideas') ? 'block' : 'none';
  if (kpiContacts) kpiContacts.style.display = hasPermission('contacts') ? 'block' : 'none';

  // Dashboard Recent Activity cards
  const dashApps = document.getElementById('dash-card-apps');
  const dashIdeas = document.getElementById('dash-card-ideas');
  const dashContacts = document.getElementById('dash-card-contacts');
  if (dashApps) dashApps.style.display = hasPermission('applications') ? 'block' : 'none';
  if (dashIdeas) dashIdeas.style.display = hasPermission('ideas') ? 'block' : 'none';
  if (dashContacts) dashContacts.style.display = hasPermission('contacts') ? 'block' : 'none';

  // If the user lands on an unauthorized tab, redirect to dashboard or first permitted tab
  const activePanel = document.querySelector('.content-panel.active');
  if (activePanel) {
    const currentTabId = activePanel.id.replace('panel-', '');
    if (currentTabId !== 'dashboard' && !hasPermission(currentTabId)) {
      switchTab('dashboard');
    }
  }
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
  // Prevent navigating to unauthorized modules
  if (tabId !== 'dashboard' && !hasPermission(tabId)) {
    console.warn(`Access denied to module '${tabId}': User lacks required permission.`);
    return;
  }

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
        if (snapshot.docs) {
          const liveApps = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          liveApps.sort((a, b) => {
            const dateA = new Date(a.submittedAt || a.createdAt || 0).getTime();
            const dateB = new Date(b.submittedAt || b.createdAt || 0).getTime();
            return dateB - dateA;
          });
          currentApplications = liveApps;
          updateAllUIPanels();
        }
      }, err => console.warn("Live applications listener note:", err));
      realtimeUnsubscribes.push(unsubApps);
    } catch (_) {}

    // 1b. Deleted Applications Listener (Trash Archive)
    try {
      const unsubDelApps = onSnapshot(collection(db, "deleted_applications"), (snapshot) => {
        if (snapshot.docs) {
          const liveDeleted = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          liveDeleted.sort((a, b) => {
            const dateA = new Date(a.deletedAt || a.submittedAt || 0).getTime();
            const dateB = new Date(b.deletedAt || b.submittedAt || 0).getTime();
            return dateB - dateA;
          });
          currentDeletedApplications = liveDeleted;
          updateAllUIPanels();
        }
      }, err => console.warn("Live deleted_applications listener note:", err));
      realtimeUnsubscribes.push(unsubDelApps);
    } catch (_) {}

    // 2. Ideas Listener
    try {
      const unsubIdeas = onSnapshot(collection(db, "idea_submissions"), (snapshot) => {
        if (snapshot.docs) {
          const liveIdeas = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          liveIdeas.sort((a, b) => {
            const dateA = new Date(a.submittedAt || a.createdAt || 0).getTime();
            const dateB = new Date(b.submittedAt || b.createdAt || 0).getTime();
            return dateB - dateA;
          });
          currentIdeas = liveIdeas;
          updateAllUIPanels();
        }
      }, err => console.warn("Live ideas listener note:", err));
      realtimeUnsubscribes.push(unsubIdeas);
    } catch (_) {}

    // 3. Jobs Listener
    try {
      const unsubJobs = onSnapshot(collection(db, "jobs"), (snapshot) => {
        if (snapshot.docs && snapshot.docs.length > 0) {
          currentJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() })).filter(j => !j.isDeleted);
          updateAllUIPanels();
        }
      }, err => console.warn("Live jobs listener note:", err));
      realtimeUnsubscribes.push(unsubJobs);
    } catch (_) {}

    // 4. Products Listener
    try {
      const unsubProds = onSnapshot(collection(db, "products"), (snapshot) => {
        if (snapshot.docs && snapshot.docs.length > 0) {
          currentProducts = snapshot.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => !p.isDeleted);
          updateAllUIPanels();
        }
      }, err => console.warn("Live products listener note:", err));
      realtimeUnsubscribes.push(unsubProds);
    } catch (_) {}

    // 5. Contact Messages Listener
    try {
      const unsubContacts = onSnapshot(collection(db, "contact_messages"), (snapshot) => {
        if (snapshot.docs) {
          const liveContacts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
          liveContacts.sort((a, b) => {
            const dateA = new Date(a.submittedAt || a.createdAt || 0).getTime();
            const dateB = new Date(b.submittedAt || b.createdAt || 0).getTime();
            return dateB - dateA;
          });
          currentContacts = liveContacts;
          updateAllUIPanels();
        }
      }, err => console.warn("Live contacts listener note:", err));
      realtimeUnsubscribes.push(unsubContacts);
    } catch (_) {}

    // 6. Team Members Listener
    try {
      const unsubTeam = onSnapshot(collection(db, "team"), (snapshot) => {
        if (snapshot.docs && snapshot.docs.length > 0) {
          let liveTeam = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

          for (const adminDef of PERMANENT_SUPER_ADMINS) {
            const foundAdmin = liveTeam.find(m => (m.email || '').toLowerCase().trim() === adminDef.email);
            if (!foundAdmin) {
              liveTeam.unshift(adminDef);
            } else {
              foundAdmin.isSuperAdmin = true;
              foundAdmin.role = 'Super Admin';
              foundAdmin.permissions = { products: true, jobs: true, applications: true, ideas: true, contacts: true, team: true };
            }
          }

          currentTeam = deduplicateTeam(liveTeam);
          renderTeamTable();
        }
      }, err => console.warn("Live team listener note:", err));
      realtimeUnsubscribes.push(unsubTeam);
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

  const unreadContacts = currentContacts.filter(c => !c.isRead).length;
  if (badgeContacts) {
    badgeContacts.textContent = unreadContacts > 0 ? `${unreadContacts} new` : currentContacts.length;
    if (unreadContacts > 0) {
      badgeContacts.classList.add('rose');
    } else {
      badgeContacts.classList.remove('rose');
    }
  }

  const badgeActiveApps = document.getElementById('badge-active-apps-count');
  const badgeTrashApps = document.getElementById('badge-trash-apps-count');
  if (badgeActiveApps) badgeActiveApps.textContent = currentApplications.length;
  if (badgeTrashApps) badgeTrashApps.textContent = currentDeletedApplications.length;

  populateAppRoleFilter();

  renderDashboardActivity();
  renderProductsTable();
  renderJobsTable();
  renderApplicationsTable();
  renderIdeasTable();
  renderContactsTable();
  renderTeamTable();
}

async function loadAllData() {
  // Ensure baseline products, jobs, and team are active
  if (!currentProducts || currentProducts.length === 0) currentProducts = [...DEFAULT_PRODUCTS];
  if (!currentJobs || currentJobs.length === 0) currentJobs = [...DEFAULT_JOBS];
  if (!currentTeam || currentTeam.length === 0) currentTeam = [...PERMANENT_SUPER_ADMINS];

  updateAllUIPanels();

  // Live Firebase sync if configured
  if (isFirebaseConfigured()) {
    const statusText = document.getElementById('firestore-sync-status-text');
    if (statusText) statusText.textContent = 'Firestore: Syncing...';

    try {
      const { getFirestore, collection, getDocs, doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(app);

      // Safe getDocs helper
      const safeQueryDocs = async (colName) => {
        try {
          const snap = await getDocs(collection(db, colName));
          return snap.docs ? snap.docs.map(d => ({ id: d.id, ...d.data() })) : [];
        } catch (e) {
          console.warn(`Firestore read warning for ${colName}:`, e.message || e);
          return [];
        }
      };

      // 1. Fetch Job Applications (Check both 'job_applications' & 'applications')
      try {
        const appMap = new Map();
        const apps1 = await safeQueryDocs("job_applications");
        apps1.forEach(d => appMap.set(d.id, d));

        const apps2 = await safeQueryDocs("applications");
        apps2.forEach(d => {
          if (!appMap.has(d.id)) appMap.set(d.id, d);
        });

        if (appMap.size > 0) {
          const liveApps = Array.from(appMap.values());
          liveApps.sort((a, b) => {
            const dateA = new Date(a.submittedAt || a.createdAt || 0).getTime();
            const dateB = new Date(b.submittedAt || b.createdAt || 0).getTime();
            return dateB - dateA;
          });
          currentApplications = liveApps;
        } else {
          currentApplications = [];
        }

        const delApps = await safeQueryDocs("deleted_applications");
        delApps.sort((a, b) => {
          const dateA = new Date(a.deletedAt || a.submittedAt || 0).getTime();
          const dateB = new Date(b.deletedAt || b.submittedAt || 0).getTime();
          return dateB - dateA;
        });
        currentDeletedApplications = delApps;
      } catch (err) {
        console.warn("Application inbox sync issue:", err);
      }

      // 2. Fetch Jobs (Career Positions)
      try {
        const delJobs = await safeQueryDocs("deleted_jobs");
        const deletedJobIds = new Set(delJobs.map(d => d.id));

        const remoteJobs = await safeQueryDocs("jobs");
        let validJobs = remoteJobs.filter(j => !deletedJobIds.has(j.id) && !j.isDeleted);

        if (validJobs.length > 0) {
          currentJobs = validJobs;
        } else if (currentJobs.length === 0) {
          currentJobs = [...DEFAULT_JOBS];
        }
      } catch (err) {
        console.warn("Job positions sync issue:", err);
      }

      // 3. Fetch Products
      try {
        const delProds = await safeQueryDocs("deleted_products");
        const deletedProdIds = new Set(delProds.map(d => d.id));

        const remoteProds = await safeQueryDocs("products");
        let validProds = remoteProds.filter(p => !deletedProdIds.has(p.id) && !p.isDeleted);

        if (validProds.length > 0) {
          currentProducts = validProds;
        } else if (currentProducts.length === 0) {
          currentProducts = [...DEFAULT_PRODUCTS];
        }
      } catch (err) {
        console.warn("Products sync issue:", err);
      }

      // 4. Fetch SaaS Ideas directly from Firebase
      try {
        const ideaMap = new Map();
        const ideas1 = await safeQueryDocs("idea_submissions");
        ideas1.forEach(d => ideaMap.set(d.id, d));

        const ideas2 = await safeQueryDocs("ideas");
        ideas2.forEach(d => {
          if (!ideaMap.has(d.id)) ideaMap.set(d.id, d);
        });

        if (ideaMap.size > 0) {
          const liveIdeas = Array.from(ideaMap.values());
          liveIdeas.sort((a, b) => {
            const dateA = new Date(a.submittedAt || a.createdAt || 0).getTime();
            const dateB = new Date(b.submittedAt || b.createdAt || 0).getTime();
            return dateB - dateA;
          });
          currentIdeas = liveIdeas;
        } else {
          currentIdeas = [];
        }
      } catch (err) {
        console.warn("Ideas sync issue:", err);
      }

      // 5. Fetch Contact Inquiries directly from Firebase
      try {
        const contactMap = new Map();
        const contacts1 = await safeQueryDocs("contact_messages");
        contacts1.forEach(d => contactMap.set(d.id, d));

        const contacts2 = await safeQueryDocs("contacts");
        contacts2.forEach(d => {
          if (!contactMap.has(d.id)) contactMap.set(d.id, d);
        });

        if (contactMap.size > 0) {
          const liveContacts = Array.from(contactMap.values());
          liveContacts.sort((a, b) => {
            const dateA = new Date(a.submittedAt || a.createdAt || 0).getTime();
            const dateB = new Date(b.submittedAt || b.createdAt || 0).getTime();
            return dateB - dateA;
          });
          currentContacts = liveContacts;
        } else {
          currentContacts = [];
        }
      } catch (err) {
        console.warn("Contacts sync issue:", err);
      }

      // 6. Fetch Team Members from Firestore
      try {
        const fetchedTeam = await safeQueryDocs("team");

        for (const adminDef of PERMANENT_SUPER_ADMINS) {
          const found = fetchedTeam.find(m => (m.email || '').toLowerCase().trim() === adminDef.email);
          if (!found) {
            fetchedTeam.unshift(adminDef);
            await setDoc(doc(db, "team", adminDef.id), adminDef, { merge: true }).catch(() => {});
          } else {
            found.isSuperAdmin = true;
            found.role = 'Super Admin';
            found.permissions = { products: true, jobs: true, applications: true, ideas: true, contacts: true, team: true };
          }
        }

        currentTeam = deduplicateTeam(fetchedTeam.length > 0 ? fetchedTeam : PERMANENT_SUPER_ADMINS);
      } catch (err) {
        console.warn("Team members sync issue:", err);
      }

      if (statusText) statusText.textContent = 'Firestore: Connected';
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
  const contactsBox = document.getElementById('dashboard-recent-contacts');

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
        <div style="padding: 10px 12px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 700; color: #0f172a; font-size: 0.82rem;">${escapeHtml(name)}</div>
            <div style="font-size: 0.74rem; color: #64748b;">${escapeHtml(role)} &bull; ${dateStr}</div>
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
        <div style="padding: 10px 12px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 700; color: #0f172a; font-size: 0.82rem;">${escapeHtml(title)}</div>
            <div style="font-size: 0.74rem; color: #64748b;">by ${escapeHtml(founder)} &bull; ${dateStr}</div>
          </div>
          <span class="badge amber">${escapeHtml(stage)}</span>
        </div>
      `;
      }).join('');
    }
  }

  if (contactsBox) {
    if (currentContacts.length === 0) {
      contactsBox.innerHTML = '<div class="recent-list-empty">No contact messages yet.</div>';
    } else {
      const sortedContacts = [...currentContacts].sort((a, b) => new Date(b.submittedAt || b.createdAt || 0) - new Date(a.submittedAt || a.createdAt || 0));
      contactsBox.innerHTML = sortedContacts.slice(0, 4).map(c => {
        const name = c.name || 'Anonymous';
        const subject = c.subject || 'General Inquiry';
        const dateStr = formatDateTime(c.submittedAt || c.createdAt);
        const isRead = !!c.isRead;
        const statusBadge = isRead
          ? `<span class="read-badge">Read</span>`
          : `<span class="unread-badge"><span class="unread-dot"></span> New</span>`;
        return `
        <div style="padding: 10px 12px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: background 0.15s ease;" onclick="window.viewContact('${c.id}')" onmouseenter="this.style.background='var(--bg-surface-subtle)'" onmouseleave="this.style.background='transparent'" title="Click to view message">
          <div style="min-width: 0; padding-right: 8px;">
            <div style="font-weight: 700; color: #0f172a; font-size: 0.82rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(name)}</div>
            <div style="font-size: 0.74rem; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(subject)} &bull; ${dateStr}</div>
          </div>
          <div style="flex-shrink: 0;">${statusBadge}</div>
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
  if (!tbody) return;

  const searchInput = document.getElementById('search-products-input');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  const filtered = currentProducts.filter(p => {
    if (!query) return true;
    const name = (p.name || '').toLowerCase();
    const tagline = (p.tagline || '').toLowerCase();
    const category = (p.category || '').toLowerCase();
    const status = (p.status || '').toLowerCase();
    return name.includes(query) || tagline.includes(query) || category.includes(query) || status.includes(query);
  });

  if (filtered.length === 0) {
    const msg = currentProducts.length === 0 ? 'No products found.' : 'No products match your search.';
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #64748b; padding: 32px 16px;">${msg}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(p => {
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

    // Automatic color mapping if not provided
    let color = p.statusColor;
    const stLower = (p.status || '').toLowerCase();
    if (!color || color === 'cyan') {
      if (stLower.includes('live')) color = 'emerald';
      else if (stLower.includes('alpha')) color = 'amber';
      else if (stLower.includes('dev') || stLower.includes('beta')) color = 'cyan';
      else color = 'cyan';
    }

    return `
      <tr>
        <td style="vertical-align: middle;">
          <strong style="color: #0f172a; font-size: 0.86rem;">${escapeHtml(p.name)}</strong>
          <div style="font-size: 0.74rem; color: #64748b; margin-top: 2px;">${escapeHtml(p.tagline || '')}</div>
        </td>
        <td style="vertical-align: middle; color: #475569;">${escapeHtml(p.category || 'Platform')}</td>
        <td style="vertical-align: middle; white-space: nowrap;">
          <span class="product-status-badge ${color}">
            <span class="status-indicator-dot"></span>
            <span>${escapeHtml(p.status)}</span>
          </span>
        </td>
        <td style="vertical-align: middle;">
          <div style="font-size: 0.8rem; margin-bottom: 4px; line-height: 1.4;">${platformsHtml}</div>
          <div style="font-size: 0.75rem;">${linksHtml}</div>
        </td>
        <td style="vertical-align: middle; white-space: nowrap; text-align: right;">
          <div style="display: inline-flex; gap: 8px; align-items: center; justify-content: flex-end;">
            <button class="btn-table-action" onclick="window.editProduct('${p.id}')">Edit</button>
            <button class="btn-table-action delete" onclick="window.deleteProduct('${p.id}')">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

const searchProductsInput = document.getElementById('search-products-input');
if (searchProductsInput) {
  searchProductsInput.addEventListener('input', () => {
    renderProductsTable();
  });
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
  const target = currentProducts.find(p => p.id === id);
  currentProducts = currentProducts.filter(p => p.id !== id);
  setLocal('products', currentProducts);
  renderProductsTable();

  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, doc, deleteDoc, setDoc, collection, query, where, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(app);

      // 1. Delete document by ID
      await deleteDoc(doc(db, "products", id)).catch(() => {});
      await setDoc(doc(db, "deleted_products", id), { id, name: target?.name || '', deletedAt: new Date().toISOString() }).catch(() => {});

      // 2. Also purge any duplicate document matching the exact name
      if (target && target.name) {
        try {
          const q = query(collection(db, "products"), where("name", "==", target.name));
          const snap = await getDocs(q);
          for (const d of snap.docs) {
            await deleteDoc(doc(db, "products", d.id)).catch(() => {});
            await setDoc(doc(db, "deleted_products", d.id), { id: d.id, name: target.name, deletedAt: new Date().toISOString() }).catch(() => {});
          }
        } catch (_) {}
      }
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
  if (!tbody) return;

  const searchInput = document.getElementById('search-jobs-input');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  const filtered = currentJobs.filter(j => {
    if (!query) return true;
    const title = (j.title || '').toLowerCase();
    const dept = (j.department || '').toLowerCase();
    const loc = (j.location || '').toLowerCase();
    const type = (j.type || '').toLowerCase();
    const exp = (j.experience || '').toLowerCase();
    const st = (j.status || '').toLowerCase();
    return title.includes(query) || dept.includes(query) || loc.includes(query) || type.includes(query) || exp.includes(query) || st.includes(query);
  });

  if (filtered.length === 0) {
    const msg = currentJobs.length === 0 ? 'No jobs posted yet.' : 'No positions match your search.';
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 32px 16px;">${msg}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(j => `
    <tr>
      <td>
        <strong style="color: #0f172a;">${escapeHtml(j.title)}</strong>
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

const searchJobsInput = document.getElementById('search-jobs-input');
if (searchJobsInput) {
  searchJobsInput.addEventListener('input', () => {
    renderJobsTable();
  });
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
  const target = currentJobs.find(j => j.id === id);
  currentJobs = currentJobs.filter(j => j.id !== id);
  setLocal('jobs', currentJobs);
  renderJobsTable();

  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, doc, deleteDoc, setDoc, collection, query, where, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(app);

      // 1. Delete document by ID
      await deleteDoc(doc(db, "jobs", id)).catch(() => {});
      await setDoc(doc(db, "deleted_jobs", id), { id, title: target?.title || '', deletedAt: new Date().toISOString() }).catch(() => {});

      // 2. Also purge any duplicate or lingering document matching the exact title
      if (target && target.title) {
        try {
          const q = query(collection(db, "jobs"), where("title", "==", target.title));
          const snap = await getDocs(q);
          for (const d of snap.docs) {
            await deleteDoc(doc(db, "jobs", d.id)).catch(() => {});
            await setDoc(doc(db, "deleted_jobs", d.id), { id: d.id, title: target.title, deletedAt: new Date().toISOString() }).catch(() => {});
          }
        } catch (_) {}
      }
    } catch (err) {
      console.warn("Could not delete job from Firestore:", err);
    }
  }
};

/* ==========================================================================
   APPLICATIONS INBOX: FILTERING, MASS ACTIONS & FIREBASE TRASH ARCHIVE
   ========================================================================== */

function populateAppRoleFilter() {
  const roleSelect = document.getElementById('filter-app-role');
  if (!roleSelect) return;

  const currentSelected = roleSelect.value || 'all';
  const roleSet = new Set();

  // Extract from current open positions
  currentJobs.forEach(j => {
    if (j.title && j.title.trim()) roleSet.add(j.title.trim());
  });

  // Extract from active & deleted applications
  currentApplications.forEach(a => {
    const title = a.jobTitle || a.title || a.position || a.role;
    if (title && title.trim()) roleSet.add(title.trim());
  });
  currentDeletedApplications.forEach(a => {
    const title = a.jobTitle || a.title || a.position || a.role;
    if (title && title.trim()) roleSet.add(title.trim());
  });

  const sortedRoles = Array.from(roleSet).sort((a, b) => a.localeCompare(b));
  roleSelect.innerHTML = `<option value="all">All Roles (${roleSet.size})</option>` +
    sortedRoles.map(r => `<option value="${escapeHtml(r)}" ${r === currentSelected ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('');
}

function getFilteredApplications() {
  const sourceList = currentAppView === 'active' ? currentApplications : currentDeletedApplications;
  const roleFilter = (document.getElementById('filter-app-role')?.value || 'all').toLowerCase().trim();
  const statusFilter = (document.getElementById('filter-app-status')?.value || 'all').trim();
  const dateFilter = (document.getElementById('filter-app-date')?.value || 'all').trim();
  const searchQuery = (document.getElementById('search-app-input')?.value || '').toLowerCase().trim();

  return sourceList.filter(app => {
    // 1. Role Filter
    if (roleFilter !== 'all') {
      const jobTitle = (app.jobTitle || app.title || app.position || app.role || '').toLowerCase().trim();
      if (jobTitle !== roleFilter) return false;
    }

    // 2. Status Filter (Only applicable in Active view)
    if (currentAppView === 'active' && statusFilter !== 'all') {
      const status = (app.status || 'New').trim();
      const normStatus = status === 'Reviewing' ? 'Under Review' : status;
      if (normStatus.toLowerCase() !== statusFilter.toLowerCase()) return false;
    }

    // 3. Submission Date Filter
    if (dateFilter !== 'all') {
      const rawDate = currentAppView === 'active' ? (app.submittedAt || app.createdAt) : (app.deletedAt || app.submittedAt || app.createdAt);
      if (!rawDate) return false;
      const appDate = typeof rawDate?.toDate === 'function' ? rawDate.toDate() : new Date(rawDate);
      const appTime = appDate.getTime();
      if (isNaN(appTime)) return false;

      const now = Date.now();
      if (dateFilter === 'today') {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        if (appTime < todayStart.getTime()) return false;
      } else if (dateFilter === '7d') {
        if (now - appTime > 7 * 24 * 60 * 60 * 1000) return false;
      } else if (dateFilter === '30d') {
        if (now - appTime > 30 * 24 * 60 * 60 * 1000) return false;
      } else if (dateFilter === '90d') {
        if (now - appTime > 90 * 24 * 60 * 60 * 1000) return false;
      } else if (dateFilter === 'custom') {
        if (selectedCustomDate) {
          const appYear = appDate.getFullYear();
          const appMonth = String(appDate.getMonth() + 1).padStart(2, '0');
          const appDay = String(appDate.getDate()).padStart(2, '0');
          const appDateStr = `${appYear}-${appMonth}-${appDay}`;
          if (appDateStr !== selectedCustomDate) return false;
        }
      }
    }

    // 4. Search Query Filter (Applicant name, email, phone, role, notes, internal recruiter notes)
    if (searchQuery) {
      const name = (app.applicantName || app.name || app.fullName || '').toLowerCase();
      const email = (app.applicantEmail || app.email || '').toLowerCase();
      const phone = (app.applicantPhone || app.phone || app.mobile || '').toLowerCase();
      const role = (app.jobTitle || app.title || app.position || app.role || '').toLowerCase();
      const notes = (app.notes || app.note || app.coverLetter || '').toLowerCase();
      const internalNotes = (app.internalNotes || '').toLowerCase();
      const matches = name.includes(searchQuery) || email.includes(searchQuery) || phone.includes(searchQuery) || role.includes(searchQuery) || notes.includes(searchQuery) || internalNotes.includes(searchQuery);
      if (!matches) return false;
    }

    return true;
  });
}

function renderApplicationsTable() {
  const tbody = document.getElementById('applications-table-body');
  if (!tbody) return;

  const displayedApps = getFilteredApplications();
  const allSource = currentAppView === 'active' ? currentApplications : currentDeletedApplications;

  // Update Result Count Meta
  const resultsMeta = document.getElementById('app-results-count');
  if (resultsMeta) {
    const totalCount = allSource.length;
    resultsMeta.textContent = `Showing ${displayedApps.length} of ${totalCount}`;
  }

  // Update Export Dropdown Badges
  const badgeFiltered = document.getElementById('export-filtered-count-badge');
  const badgeAll = document.getElementById('export-all-count-badge');
  const badgeSelected = document.getElementById('export-selected-count-badge');
  const optSelected = document.getElementById('export-opt-selected');

  if (badgeFiltered) badgeFiltered.textContent = displayedApps.length;
  if (badgeAll) badgeAll.textContent = allSource.length;
  if (badgeSelected) badgeSelected.textContent = selectedAppIds.size;
  if (optSelected) optSelected.disabled = selectedAppIds.size === 0;

  // Update Dynamic Table Headers
  const thDate = document.getElementById('th-app-date');
  const thStatus = document.getElementById('th-app-status');
  if (thDate) thDate.textContent = currentAppView === 'active' ? 'Submitted' : 'Deleted Date';
  if (thStatus) thStatus.textContent = currentAppView === 'active' ? 'Status' : 'Deleted By';

  // Update Master Checkbox state
  const selectAllCb = document.getElementById('app-select-all');
  if (selectAllCb) {
    selectAllCb.checked = displayedApps.length > 0 && displayedApps.every(a => selectedAppIds.has(a.id));
  }

  // Update Bulk Actions Toolbar
  updateBulkActionBar();

  if (displayedApps.length === 0) {
    const emptyMsg = currentAppView === 'active'
      ? (currentApplications.length === 0 ? 'No applications received yet.' : 'No active applications match the selected filters.')
      : (currentDeletedApplications.length === 0 ? 'Trash archive is currently empty.' : 'No archived applications match the selected filters.');
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #64748b; padding: 32px 20px;">${emptyMsg}</td></tr>`;
    return;
  }

  tbody.innerHTML = displayedApps.map(app => {
    const applicantName = app.applicantName || app.name || app.fullName || 'Anonymous Candidate';
    const jobTitle = app.jobTitle || app.title || app.position || app.role || 'General Application';
    const email = app.applicantEmail || app.email || 'N/A';
    const phone = app.applicantPhone || app.phone || app.mobile || 'N/A';
    const resume = app.resumeUrl || app.resume || '';
    const status = app.status || 'New';
    const dateStr = formatDateTime(currentAppView === 'active' ? (app.submittedAt || app.createdAt) : (app.deletedAt || app.submittedAt));
    const isSelected = selectedAppIds.has(app.id);

    // Row status column
    let statusCellHtml = '';
    if (currentAppView === 'active') {
      const normStatus = status === 'Reviewing' ? 'Under Review' : status;
      const statusSlug = normStatus.toLowerCase().replace(/\s+/g, '-');
      statusCellHtml = `
        <select class="form-select-sm app-status-select status-${statusSlug}" onchange="const s = this.value; this.className='form-select-sm app-status-select status-' + s.toLowerCase().replace(/\\s+/g, '-'); window.updateAppStatus('${app.id}', s)">
          <option value="New" ${normStatus === 'New' ? 'selected' : ''}>New</option>
          <option value="Under Review" ${normStatus === 'Under Review' ? 'selected' : ''}>Under Review</option>
          <option value="Shortlisted" ${normStatus === 'Shortlisted' ? 'selected' : ''}>Shortlisted</option>
          <option value="Interview" ${normStatus === 'Interview' ? 'selected' : ''}>Interview</option>
          <option value="Hired" ${normStatus === 'Hired' ? 'selected' : ''}>Hired</option>
          <option value="Rejected" ${normStatus === 'Rejected' ? 'selected' : ''}>Rejected</option>
        </select>
      `;
    } else {
      statusCellHtml = `
        <span class="badge rose" style="font-size: 0.72rem;" title="Deleted by ${escapeHtml(app.deletedBy || 'Admin')}">
          ${escapeHtml(app.deletedBy || 'Admin')}
        </span>
      `;
    }

    // Row actions column
    let actionsCellHtml = '';
    if (currentAppView === 'active') {
      actionsCellHtml = `
        <div class="app-row-actions">
          <button class="btn-table-action" onclick="window.viewApplication('${app.id}')" title="View Full Details">View</button>
          <button class="btn-table-action delete" onclick="window.deleteApplicationPermanently('${app.id}')" title="Permanently Delete from Firebase">Delete</button>
        </div>
      `;
    } else {
      actionsCellHtml = `
        <div class="app-row-actions">
          <button class="btn-table-action" onclick="window.viewApplication('${app.id}')" title="View Full Details">View</button>
          <button class="btn-table-action" style="color: #047857; border-color: #a7f3d0;" onclick="window.restoreApplication('${app.id}')" title="Restore to Active Applications">Restore</button>
          <button class="btn-table-action delete" onclick="window.deleteApplicationPermanently('${app.id}')" title="Delete Permanently from Firestore">Purge</button>
        </div>
      `;
    }

    return `
      <tr class="${isSelected ? 'row-selected' : ''}">
        <td style="text-align: center;">
          <input type="checkbox" class="table-checkbox app-row-checkbox" data-id="${app.id}" ${isSelected ? 'checked' : ''} onchange="window.toggleAppSelect('${app.id}', this.checked)" />
        </td>
        <td>
          <strong style="color: #0f172a; display: block; line-height: 1.3;">${escapeHtml(applicantName)}</strong>
        </td>
        <td>
          <span class="app-role-pill">${escapeHtml(jobTitle)}</span>
        </td>
        <td>
          <div>${email !== 'N/A' ? `<a href="mailto:${escapeHtml(email)}" style="color: #0f172a; text-decoration: none;">${escapeHtml(email)}</a>` : '<span style="color: #64748b;">N/A</span>'}</div>
          <div style="font-size: 0.74rem; color: #64748b;">${escapeHtml(phone)}</div>
        </td>
        <td>
          ${resume ? `<a href="${escapeHtml(resume)}" target="_blank" style="color: #0284c7; text-decoration: underline; font-size: 0.78rem;">Resume ↗</a>` : '<span style="color: #94a3b8; font-size: 0.76rem;">No file</span>'}
        </td>
        <td style="font-size: 0.76rem; color: #64748b; white-space: nowrap;">${dateStr}</td>
        <td>${statusCellHtml}</td>
        <td>${actionsCellHtml}</td>
      </tr>
    `;
  }).join('');
}

function updateBulkActionBar() {
  const bulkBar = document.getElementById('app-bulk-bar');
  const countEl = document.getElementById('bulk-selected-count');
  const buttonsEl = document.getElementById('bulk-action-buttons');
  if (!bulkBar || !countEl || !buttonsEl) return;

  if (selectedAppIds.size === 0) {
    bulkBar.style.display = 'none';
    return;
  }

  bulkBar.style.display = 'flex';
  countEl.textContent = `${selectedAppIds.size} application${selectedAppIds.size > 1 ? 's' : ''} selected`;

  if (currentAppView === 'active') {
    buttonsEl.innerHTML = `
      <button type="button" class="btn-bulk-action" style="background: #ecfdf5; border: 1px solid #a7f3d0; color: #047857;" onclick="window.exportSelectedApplicationsToExcel()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        <span>Export Selected (${selectedAppIds.size})</span>
      </button>
      <button type="button" class="btn-bulk-action delete" onclick="window.bulkPermanentlyDeleteActive()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        <span>Delete Selected (${selectedAppIds.size})</span>
      </button>
      <button type="button" class="btn-bulk-action" style="background: #f1f5f9; border: 1px solid #cbd5e1; color: #334155;" onclick="window.bulkMoveToTrash()">
        <span>Move to Trash (${selectedAppIds.size})</span>
      </button>
      <button type="button" class="btn-bulk-action deselect" onclick="window.deselectAllApps()">Deselect All</button>
    `;
  } else {
    buttonsEl.innerHTML = `
      <button type="button" class="btn-bulk-action" style="background: #ecfdf5; border: 1px solid #a7f3d0; color: #047857;" onclick="window.exportSelectedApplicationsToExcel()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        <span>Export Selected (${selectedAppIds.size})</span>
      </button>
      <button type="button" class="btn-bulk-action restore" onclick="window.bulkRestoreApplications()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
        <span>Restore Selected (${selectedAppIds.size})</span>
      </button>
      <button type="button" class="btn-bulk-action delete" onclick="window.bulkPermanentlyDelete()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        <span>Purge Permanently (${selectedAppIds.size})</span>
      </button>
      <button type="button" class="btn-bulk-action deselect" onclick="window.deselectAllApps()">Deselect All</button>
    `;
  }
}

// Checkbox selection methods
window.toggleAppSelect = (id, checked) => {
  if (checked) {
    selectedAppIds.add(id);
  } else {
    selectedAppIds.delete(id);
  }
  renderApplicationsTable();
};

window.deselectAllApps = () => {
  selectedAppIds.clear();
  renderApplicationsTable();
};

// Master Checkbox handler
const selectAllCb = document.getElementById('app-select-all');
if (selectAllCb) {
  selectAllCb.addEventListener('change', (e) => {
    const displayed = getFilteredApplications();
    if (e.target.checked) {
      displayed.forEach(a => selectedAppIds.add(a.id));
    } else {
      displayed.forEach(a => selectedAppIds.delete(a.id));
    }
    renderApplicationsTable();
  });
}

// View Switcher Tabs
const tabAppActive = document.getElementById('tab-app-active');
const tabAppTrash = document.getElementById('tab-app-trash');
const statusFilterWrapper = document.getElementById('status-filter-wrapper');

if (tabAppActive) {
  tabAppActive.addEventListener('click', () => {
    if (currentAppView === 'active') return;
    currentAppView = 'active';
    tabAppActive.classList.add('active');
    if (tabAppTrash) tabAppTrash.classList.remove('active');
    if (statusFilterWrapper) statusFilterWrapper.style.display = 'flex';
    selectedAppIds.clear();
    renderApplicationsTable();
  });
}

if (tabAppTrash) {
  tabAppTrash.addEventListener('click', () => {
    if (currentAppView === 'trash') return;
    currentAppView = 'trash';
    tabAppTrash.classList.add('active');
    if (tabAppActive) tabAppActive.classList.remove('active');
    if (statusFilterWrapper) statusFilterWrapper.style.display = 'none';
    selectedAppIds.clear();
    renderApplicationsTable();
  });
}

// Filters event listeners
const filterAppRoleSelect = document.getElementById('filter-app-role');
if (filterAppRoleSelect) {
  filterAppRoleSelect.addEventListener('change', () => {
    selectedAppIds.clear();
    renderApplicationsTable();
  });
}

const filterAppStatusSelect = document.getElementById('filter-app-status');
if (filterAppStatusSelect) {
  filterAppStatusSelect.addEventListener('change', () => {
    selectedAppIds.clear();
    renderApplicationsTable();
  });
}

const searchAppInput = document.getElementById('search-app-input');
if (searchAppInput) {
  searchAppInput.addEventListener('input', () => {
    renderApplicationsTable();
  });
}

// =========================================
// INTERACTIVE CALENDAR DATE PICKER ENGINE
// =========================================
let selectedCustomDate = null;
let calViewingYear = new Date().getFullYear();
let calViewingMonth = new Date().getMonth();

const CAL_MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function initCalendarSelectors() {
  const monthSelect = document.getElementById('cal-month-select');
  const yearSelect = document.getElementById('cal-year-select');
  if (!monthSelect || !yearSelect) return;

  if (monthSelect.children.length === 0) {
    monthSelect.innerHTML = CAL_MONTH_NAMES_SHORT.map((m, idx) => `<option value="${idx}">${m}</option>`).join('');
  }

  if (yearSelect.children.length === 0) {
    const curYear = new Date().getFullYear();
    const years = [];
    for (let y = curYear - 4; y <= curYear + 2; y++) {
      years.push(y);
    }
    yearSelect.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
  }
}

function renderCalendarPopover() {
  initCalendarSelectors();

  const monthSelect = document.getElementById('cal-month-select');
  const yearSelect = document.getElementById('cal-year-select');
  const daysGrid = document.getElementById('cal-days-grid');
  if (!monthSelect || !yearSelect || !daysGrid) return;

  monthSelect.value = calViewingMonth;
  yearSelect.value = calViewingYear;

  const firstDayIndex = new Date(calViewingYear, calViewingMonth, 1).getDay();
  const daysInCurrentMonth = new Date(calViewingYear, calViewingMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(calViewingYear, calViewingMonth, 0).getDate();

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  let html = '';

  // Trailing days from previous month
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    html += `<div class="cal-day-cell other-month">${d}</div>`;
  }

  // Days in current month
  for (let day = 1; day <= daysInCurrentMonth; day++) {
    const dateStr = `${calViewingYear}-${String(calViewingMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === selectedCustomDate;

    let classes = ['cal-day-cell'];
    if (isToday) classes.push('is-today');
    if (isSelected) classes.push('selected');

    html += `<div class="${classes.join(' ')}" data-date="${dateStr}">${day}</div>`;
  }

  // Next month leading days
  const totalSlots = (firstDayIndex + daysInCurrentMonth) > 35 ? 42 : 35;
  const remaining = totalSlots - (firstDayIndex + daysInCurrentMonth);
  for (let nextDay = 1; nextDay <= remaining; nextDay++) {
    html += `<div class="cal-day-cell other-month">${nextDay}</div>`;
  }

  daysGrid.innerHTML = html;
}

function setCustomCalendarDate(dateStr) {
  selectedCustomDate = dateStr;
  const triggerLabel = document.getElementById('calendar-trigger-label');
  const triggerBtn = document.getElementById('btn-calendar-trigger');
  const popover = document.getElementById('calendar-popover');

  if (dateStr) {
    const [y, m, d] = dateStr.split('-');
    const mName = CAL_MONTH_NAMES_SHORT[parseInt(m, 10) - 1] || m;
    if (triggerLabel) triggerLabel.textContent = `${mName} ${parseInt(d, 10)}, ${y}`;
    if (triggerBtn) triggerBtn.classList.add('has-date');
  } else {
    if (triggerLabel) triggerLabel.textContent = 'Select Date';
    if (triggerBtn) triggerBtn.classList.remove('has-date');
  }

  if (popover) popover.style.display = 'none';
  selectedAppIds.clear();
  renderApplicationsTable();
}

// Calendar Navigation & Actions
const calMonthSelect = document.getElementById('cal-month-select');
if (calMonthSelect) {
  calMonthSelect.addEventListener('change', () => {
    calViewingMonth = parseInt(calMonthSelect.value, 10);
    renderCalendarPopover();
  });
}

const calYearSelect = document.getElementById('cal-year-select');
if (calYearSelect) {
  calYearSelect.addEventListener('change', () => {
    calViewingYear = parseInt(calYearSelect.value, 10);
    renderCalendarPopover();
  });
}

const calPrevMonth = document.getElementById('cal-prev-month');
if (calPrevMonth) {
  calPrevMonth.addEventListener('click', () => {
    calViewingMonth--;
    if (calViewingMonth < 0) {
      calViewingMonth = 11;
      calViewingYear--;
    }
    renderCalendarPopover();
  });
}

const calNextMonth = document.getElementById('cal-next-month');
if (calNextMonth) {
  calNextMonth.addEventListener('click', () => {
    calViewingMonth++;
    if (calViewingMonth > 11) {
      calViewingMonth = 0;
      calViewingYear++;
    }
    renderCalendarPopover();
  });
}

const calDaysGrid = document.getElementById('cal-days-grid');
if (calDaysGrid) {
  calDaysGrid.addEventListener('click', (e) => {
    const cell = e.target.closest('.cal-day-cell[data-date]');
    if (cell && cell.dataset.date) {
      setCustomCalendarDate(cell.dataset.date);
    }
  });
}

const calBtnToday = document.getElementById('cal-btn-today');
if (calBtnToday) {
  calBtnToday.addEventListener('click', () => {
    const now = new Date();
    calViewingYear = now.getFullYear();
    calViewingMonth = now.getMonth();
    const todayStr = `${calViewingYear}-${String(calViewingMonth + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    setCustomCalendarDate(todayStr);
  });
}

const calBtnClear = document.getElementById('cal-btn-clear');
if (calBtnClear) {
  calBtnClear.addEventListener('click', () => {
    setCustomCalendarDate(null);
  });
}

// Trigger Button Toggle
const btnCalendarTrigger = document.getElementById('btn-calendar-trigger');
const calendarPopover = document.getElementById('calendar-popover');
const calendarPickerWrapper = document.getElementById('calendar-picker-wrapper');

function ensurePopoverInViewport() {
  if (!calendarPopover) return;
  calendarPopover.style.right = '0';
  calendarPopover.style.left = 'auto';

  const rect = calendarPopover.getBoundingClientRect();
  const viewportWidth = window.innerWidth;

  if (rect.right > viewportWidth - 12) {
    const diff = rect.right - (viewportWidth - 12);
    calendarPopover.style.right = `${diff}px`;
  }
  const updatedRect = calendarPopover.getBoundingClientRect();
  if (updatedRect.left < 12) {
    calendarPopover.style.left = '0';
    calendarPopover.style.right = 'auto';
  }
}

if (btnCalendarTrigger && calendarPopover) {
  btnCalendarTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isShowing = calendarPopover.style.display === 'block';
    calendarPopover.style.display = isShowing ? 'none' : 'block';
    if (!isShowing) {
      renderCalendarPopover();
      ensurePopoverInViewport();
    }
  });

  document.addEventListener('click', (e) => {
    if (calendarPickerWrapper && !calendarPickerWrapper.contains(e.target)) {
      calendarPopover.style.display = 'none';
    }
  });
}

// Date Dropdown Handler
const filterAppDateSelect = document.getElementById('filter-app-date');
if (filterAppDateSelect) {
  filterAppDateSelect.addEventListener('change', () => {
    selectedAppIds.clear();
    if (filterAppDateSelect.value === 'custom') {
      if (calendarPickerWrapper) {
        calendarPickerWrapper.style.display = 'inline-flex';
        if (calendarPopover) {
          calendarPopover.style.display = 'block';
          renderCalendarPopover();
          ensurePopoverInViewport();
        }
      }
    } else {
      if (calendarPickerWrapper) calendarPickerWrapper.style.display = 'none';
      if (calendarPopover) calendarPopover.style.display = 'none';
      selectedCustomDate = null;
      const triggerLabel = document.getElementById('calendar-trigger-label');
      if (triggerLabel) triggerLabel.textContent = 'Select Date';
      if (btnCalendarTrigger) btnCalendarTrigger.classList.remove('has-date');
    }
    renderApplicationsTable();
  });
}

const btnResetAppFilters = document.getElementById('btn-reset-app-filters');
if (btnResetAppFilters) {
  btnResetAppFilters.addEventListener('click', () => {
    if (searchAppInput) searchAppInput.value = '';
    if (filterAppRoleSelect) filterAppRoleSelect.value = 'all';
    if (filterAppStatusSelect) filterAppStatusSelect.value = 'all';
    if (filterAppDateSelect) filterAppDateSelect.value = 'all';
    if (calendarPickerWrapper) calendarPickerWrapper.style.display = 'none';
    if (calendarPopover) calendarPopover.style.display = 'none';
    selectedCustomDate = null;
    const triggerLabel = document.getElementById('calendar-trigger-label');
    if (triggerLabel) triggerLabel.textContent = 'Select Date';
    if (btnCalendarTrigger) btnCalendarTrigger.classList.remove('has-date');
    selectedAppIds.clear();
    renderApplicationsTable();
  });
}

/* ==========================================================================
   APPLICATIONS EXCEL EXPORT ENGINE (SheetJS + CSV Fallback)
   ========================================================================== */

let isSheetJSLoading = false;
async function loadSheetJS() {
  if (window.XLSX) return window.XLSX;
  if (isSheetJSLoading) {
    let waited = 0;
    while (!window.XLSX && waited < 50) {
      await new Promise(r => setTimeout(r, 100));
      waited++;
    }
    if (window.XLSX) return window.XLSX;
  }
  isSheetJSLoading = true;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.async = true;
    script.onload = () => {
      isSheetJSLoading = false;
      resolve(window.XLSX);
    };
    script.onerror = (err) => {
      isSheetJSLoading = false;
      reject(err);
    };
    document.head.appendChild(script);
  });
}

function exportApplicationsToExcel(appsToExport, filenamePrefix = 'Synerbit_Applications') {
  if (!appsToExport || appsToExport.length === 0) {
    alert('No applications found to export for the current filter criteria.');
    return;
  }

  const rows = appsToExport.map((app, idx) => {
    const applicantName = app.applicantName || app.name || app.fullName || 'Anonymous Candidate';
    const jobTitle = app.jobTitle || app.title || app.position || app.role || 'General Application';
    const email = app.applicantEmail || app.email || '';
    const phone = app.applicantPhone || app.phone || app.mobile || '';
    const status = app.status || 'New';
    const dateFormatted = formatDateTime(app.submittedAt || app.createdAt);
    const portfolio = app.portfolioUrl || app.portfolio || '';
    const resume = app.resumeUrl || app.resume || '';
    const candidateNotes = app.notes || app.note || app.coverLetter || '';
    const internalNotes = app.internalNotes || '';

    return {
      'S.No': idx + 1,
      'Candidate ID': app.id || '',
      'Submitted Date': dateFormatted,
      'Applicant Name': applicantName,
      'Role Applied For': jobTitle,
      'Status': status,
      'Email Address': email,
      'Phone Number': phone,
      'Portfolio / Links': portfolio,
      'Resume URL': resume,
      'Candidate Statement / Cover Note': candidateNotes,
      'Internal Recruiter Notes': internalNotes
    };
  });

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const safePrefix = filenamePrefix.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${safePrefix}_${dateStr}.xlsx`;

  loadSheetJS().then(XLSX => {
    const worksheet = XLSX.utils.json_to_sheet(rows);

    // Apply auto-fit column widths
    worksheet['!cols'] = [
      { wch: 6 },  // S.No
      { wch: 18 }, // Candidate ID
      { wch: 22 }, // Submitted Date
      { wch: 26 }, // Applicant Name
      { wch: 28 }, // Role Applied For
      { wch: 16 }, // Status
      { wch: 28 }, // Email Address
      { wch: 18 }, // Phone Number
      { wch: 32 }, // Portfolio / Links
      { wch: 36 }, // Resume URL
      { wch: 42 }, // Candidate Statement
      { wch: 42 }  // Internal Recruiter Notes
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Applications');
    XLSX.writeFile(workbook, filename);
  }).catch(err => {
    console.warn('Could not load SheetJS from CDN, falling back to CSV export:', err);
    exportToCsvFallback(rows, filename.replace('.xlsx', '.csv'));
  });
}

function exportToCsvFallback(rows, filename) {
  if (!rows || rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.map(h => `"${h.replace(/"/g, '""')}"`).join(','),
    ...rows.map(row => headers.map(h => {
      const val = (row[h] || '').toString().replace(/"/g, '""');
      return `"${val}"`;
    }).join(','))
  ];
  const csvContent = '\uFEFF' + csvLines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Bulk & Global Export Actions
window.exportSelectedApplicationsToExcel = () => {
  const allSource = currentAppView === 'active' ? currentApplications : currentDeletedApplications;
  const selected = allSource.filter(a => selectedAppIds.has(a.id));
  if (selected.length === 0) {
    alert('Please select at least one candidate using the checkboxes to export.');
    return;
  }
  exportApplicationsToExcel(selected, `Synerbit_Applications_Selected_${selected.length}`);
};

// Toggle Export Dropdown
const btnExportApps = document.getElementById('btn-export-apps-excel');
const exportAppsMenu = document.getElementById('export-apps-menu');

if (btnExportApps && exportAppsMenu) {
  btnExportApps.addEventListener('click', (e) => {
    e.stopPropagation();
    const isShowing = exportAppsMenu.style.display === 'flex';
    exportAppsMenu.style.display = isShowing ? 'none' : 'flex';
  });

  document.addEventListener('click', (e) => {
    if (!btnExportApps.contains(e.target) && !exportAppsMenu.contains(e.target)) {
      exportAppsMenu.style.display = 'none';
    }
  });
}

// Option 1: Export Current Filtered View (Role, Status, Date, Search)
const exportOptFiltered = document.getElementById('export-opt-filtered');
if (exportOptFiltered) {
  exportOptFiltered.addEventListener('click', () => {
    if (exportAppsMenu) exportAppsMenu.style.display = 'none';
    const displayed = getFilteredApplications();
    const roleVal = document.getElementById('filter-app-role')?.value || 'all';
    const statusVal = document.getElementById('filter-app-status')?.value || 'all';
    const dateVal = document.getElementById('filter-app-date')?.value || 'all';

    let prefixParts = ['Synerbit_Applications'];
    if (roleVal !== 'all') prefixParts.push(roleVal);
    if (statusVal !== 'all') prefixParts.push(statusVal);
    if (dateVal === 'custom' && selectedCustomDate) {
      prefixParts.push(selectedCustomDate);
    } else if (dateVal !== 'all') {
      prefixParts.push(dateVal);
    }
    if (prefixParts.length === 1) prefixParts.push('Filtered');

    exportApplicationsToExcel(displayed, prefixParts.join('_'));
  });
}

// Option 2: Export All Applications
const exportOptAll = document.getElementById('export-opt-all');
if (exportOptAll) {
  exportOptAll.addEventListener('click', () => {
    if (exportAppsMenu) exportAppsMenu.style.display = 'none';
    const allSource = currentAppView === 'active' ? currentApplications : currentDeletedApplications;
    exportApplicationsToExcel(allSource, 'Synerbit_Applications_All');
  });
}

// Option 3: Export Selected Applications
const exportOptSelected = document.getElementById('export-opt-selected');
if (exportOptSelected) {
  exportOptSelected.addEventListener('click', () => {
    if (exportAppsMenu) exportAppsMenu.style.display = 'none';
    window.exportSelectedApplicationsToExcel();
  });
}

// 1. Move Single Application to Trash Archive
window.moveToTrashApplication = async (id) => {
  const app = currentApplications.find(a => a.id === id);
  if (!app) return;
  if (!confirm(`Move application from "${app.applicantName || 'Candidate'}" to Trash Archive?`)) return;

  const deletedRecord = {
    ...app,
    isDeleted: true,
    deletedAt: new Date().toISOString(),
    deletedBy: currentUser?.email || 'Admin'
  };

  // Update local arrays
  currentApplications = currentApplications.filter(a => a.id !== id);
  currentDeletedApplications.unshift(deletedRecord);
  selectedAppIds.delete(id);
  setLocal('applications', currentApplications);
  setLocal('deleted_applications', currentDeletedApplications);
  updateAllUIPanels();

  // Firestore sync
  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, doc, setDoc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const fbApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(fbApp);

      // Write to deleted_applications and remove from active collection
      await setDoc(doc(db, "deleted_applications", id), deletedRecord);
      await deleteDoc(doc(db, "job_applications", id)).catch(() => {});
      await deleteDoc(doc(db, "applications", id)).catch(() => {});
    } catch (err) {
      console.warn("Firestore move to trash error:", err);
    }
  }
};

// 2. Mass Move to Trash Archive
window.bulkMoveToTrash = async () => {
  if (selectedAppIds.size === 0) return;
  const count = selectedAppIds.size;
  if (!confirm(`Move ${count} selected application${count > 1 ? 's' : ''} to Trash Archive?`)) return;

  const idsToMove = Array.from(selectedAppIds);
  const now = new Date().toISOString();
  const deletedBy = currentUser?.email || 'Admin';

  const movedRecords = [];
  idsToMove.forEach(id => {
    const app = currentApplications.find(a => a.id === id);
    if (app) {
      movedRecords.push({
        ...app,
        isDeleted: true,
        deletedAt: now,
        deletedBy
      });
    }
  });

  currentApplications = currentApplications.filter(a => !selectedAppIds.has(a.id));
  currentDeletedApplications = [...movedRecords, ...currentDeletedApplications];
  selectedAppIds.clear();

  setLocal('applications', currentApplications);
  setLocal('deleted_applications', currentDeletedApplications);
  updateAllUIPanels();

  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, doc, setDoc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const fbApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(fbApp);

      for (const rec of movedRecords) {
        await setDoc(doc(db, "deleted_applications", rec.id), rec);
        await deleteDoc(doc(db, "job_applications", rec.id)).catch(() => {});
        await deleteDoc(doc(db, "applications", rec.id)).catch(() => {});
      }
    } catch (err) {
      console.warn("Firestore bulk move to trash error:", err);
    }
  }
};

// 3. Restore Single Application
window.restoreApplication = async (id) => {
  const app = currentDeletedApplications.find(a => a.id === id);
  if (!app) return;

  const restored = { ...app };
  delete restored.isDeleted;
  delete restored.deletedAt;
  delete restored.deletedBy;

  currentDeletedApplications = currentDeletedApplications.filter(a => a.id !== id);
  currentApplications.unshift(restored);
  selectedAppIds.delete(id);

  setLocal('applications', currentApplications);
  setLocal('deleted_applications', currentDeletedApplications);
  updateAllUIPanels();

  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, doc, setDoc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const fbApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(fbApp);

      await setDoc(doc(db, "job_applications", id), restored);
      await deleteDoc(doc(db, "deleted_applications", id)).catch(() => {});
    } catch (err) {
      console.warn("Firestore restore application error:", err);
    }
  }
};

// 4. Mass Restore Applications
window.bulkRestoreApplications = async () => {
  if (selectedAppIds.size === 0) return;
  const idsToRestore = Array.from(selectedAppIds);

  const restoredList = [];
  idsToRestore.forEach(id => {
    const app = currentDeletedApplications.find(a => a.id === id);
    if (app) {
      const restored = { ...app };
      delete restored.isDeleted;
      delete restored.deletedAt;
      delete restored.deletedBy;
      restoredList.push(restored);
    }
  });

  currentDeletedApplications = currentDeletedApplications.filter(a => !selectedAppIds.has(a.id));
  currentApplications = [...restoredList, ...currentApplications];
  selectedAppIds.clear();

  setLocal('applications', currentApplications);
  setLocal('deleted_applications', currentDeletedApplications);
  updateAllUIPanels();

  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, doc, setDoc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const fbApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(fbApp);

      for (const rec of restoredList) {
        await setDoc(doc(db, "job_applications", rec.id), rec);
        await deleteDoc(doc(db, "deleted_applications", rec.id)).catch(() => {});
      }
    } catch (err) {
      console.warn("Firestore bulk restore error:", err);
    }
  }
};

// 5. Permanently Delete Single Application (Active or Trash) directly from Firebase
window.deleteApplicationPermanently = async (id) => {
  const app = currentApplications.find(a => a.id === id) || currentDeletedApplications.find(a => a.id === id);
  const applicantName = app?.applicantName || app?.name || 'Candidate';
  if (!confirm(`Are you sure you want to permanently delete the application from "${applicantName}"? This will delete it completely from Firebase backend.`)) return;

  currentApplications = currentApplications.filter(a => a.id !== id);
  currentDeletedApplications = currentDeletedApplications.filter(a => a.id !== id);
  selectedAppIds.delete(id);
  updateAllUIPanels();

  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const fbApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(fbApp);

      await Promise.allSettled([
        deleteDoc(doc(db, "job_applications", id)),
        deleteDoc(doc(db, "applications", id)),
        deleteDoc(doc(db, "deleted_applications", id))
      ]);
    } catch (err) {
      console.warn("Firestore delete application error:", err);
    }
  }
};
window.permanentlyDeleteApplication = window.deleteApplicationPermanently;

// 6. Mass Permanently Delete Active Applications directly from Firebase
window.bulkPermanentlyDeleteActive = async () => {
  if (selectedAppIds.size === 0) return;
  const count = selectedAppIds.size;
  if (!confirm(`PERMANENT ACTION: Completely delete ${count} selected application${count > 1 ? 's' : ''} from Firebase backend? This cannot be undone.`)) return;

  const idsToPurge = Array.from(selectedAppIds);
  currentApplications = currentApplications.filter(a => !selectedAppIds.has(a.id));
  currentDeletedApplications = currentDeletedApplications.filter(a => !selectedAppIds.has(a.id));
  selectedAppIds.clear();
  updateAllUIPanels();

  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const fbApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(fbApp);

      for (const id of idsToPurge) {
        await Promise.allSettled([
          deleteDoc(doc(db, "job_applications", id)),
          deleteDoc(doc(db, "applications", id)),
          deleteDoc(doc(db, "deleted_applications", id))
        ]);
      }
    } catch (err) {
      console.warn("Firestore bulk purge active error:", err);
    }
  }
};

// 7. Mass Permanently Purge Trash Applications
window.bulkPermanentlyDelete = window.bulkPermanentlyDeleteActive;

window.updateAppStatus = async (id, newStatus) => {
  const app = currentApplications.find(a => a.id === id) || currentDeletedApplications.find(a => a.id === id);
  if (app) {
    app.status = newStatus;
    setLocal('applications', currentApplications);
    setLocal('deleted_applications', currentDeletedApplications);
    renderDashboardActivity();
    renderApplicationsTable();

    if (isFirebaseConfigured()) {
      try {
        const { getFirestore, doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
        const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
        const fbApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
        const db = getFirestore(fbApp);
        await setDoc(doc(db, "job_applications", id), { status: newStatus }, { merge: true });
        try {
          await setDoc(doc(db, "applications", id), { status: newStatus }, { merge: true });
        } catch (_) {}
      } catch (e) {
        console.warn("Could not sync application status update to Firestore:", e);
      }
    }
  }
};

window.saveAppNotes = async (id) => {
  const notesEl = document.getElementById('modal-app-notes');
  if (!notesEl) return;
  const notes = notesEl.value.trim();
  const app = currentApplications.find(a => a.id === id) || currentDeletedApplications.find(a => a.id === id);
  if (app) {
    app.internalNotes = notes;
    setLocal('applications', currentApplications);
    setLocal('deleted_applications', currentDeletedApplications);
  }

  const btnSave = document.getElementById('btn-save-app-notes');
  if (btnSave) {
    btnSave.textContent = 'Saving...';
    btnSave.disabled = true;
  }

  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const fbApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(fbApp);
      await setDoc(doc(db, "job_applications", id), { internalNotes: notes }, { merge: true });
      try {
        await setDoc(doc(db, "applications", id), { internalNotes: notes }, { merge: true });
      } catch (_) {}
    } catch (e) {
      console.warn("Could not save recruiter notes to Firestore:", e);
    }
  }

  if (btnSave) {
    btnSave.textContent = 'Saved ✓';
    setTimeout(() => {
      if (btnSave) {
        btnSave.textContent = 'Save Notes';
        btnSave.disabled = false;
      }
    }, 1500);
  }
};

window.viewApplication = (id) => {
  const app = currentApplications.find(a => a.id === id) || currentDeletedApplications.find(a => a.id === id);
  if (!app) return;

  const applicantName = app.applicantName || app.name || app.fullName || 'Anonymous Candidate';
  const jobTitle = app.jobTitle || app.title || app.position || app.role || 'General Application';
  const email = app.applicantEmail || app.email || 'N/A';
  const phone = app.applicantPhone || app.phone || app.mobile || 'Not provided';
  const portfolio = app.portfolioUrl || app.portfolio || app.link || '';
  const note = app.notes || app.note || app.coverLetter || 'No note provided.';
  const resume = app.resumeUrl || app.resume || '';
  const status = app.status || 'New';
  const normStatus = status === 'Reviewing' ? 'Under Review' : status;
  const statusSlug = normStatus.toLowerCase().replace(/\s+/g, '-');
  const internalNotes = app.internalNotes || '';

  const body = document.getElementById('view-app-body');
  body.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; flex-wrap: wrap; gap: 10px; border-bottom: 1px solid var(--border-light); padding-bottom: 10px;">
      <div>
        <h4 style="color: #0f172a; font-size: 1.15rem; margin-bottom: 2px;">${escapeHtml(applicantName)}</h4>
        <div style="color: #0284c7; font-size: 0.82rem;">Applying for: ${escapeHtml(jobTitle)}</div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <label style="font-size: 0.74rem; color: #64748b; margin: 0;">Stage:</label>
        <select class="form-select-sm app-status-select status-${statusSlug}" style="padding: 3px 22px 3px 8px; font-weight: 600;" onchange="const s = this.value; this.className='form-select-sm app-status-select status-' + s.toLowerCase().replace(/\\s+/g, '-'); window.updateAppStatus('${app.id}', s)">
          <option value="New" ${normStatus === 'New' ? 'selected' : ''}>New</option>
          <option value="Under Review" ${normStatus === 'Under Review' ? 'selected' : ''}>Under Review</option>
          <option value="Shortlisted" ${normStatus === 'Shortlisted' ? 'selected' : ''}>Shortlisted</option>
          <option value="Interview" ${normStatus === 'Interview' ? 'selected' : ''}>Interview</option>
          <option value="Hired" ${normStatus === 'Hired' ? 'selected' : ''}>Hired</option>
          <option value="Rejected" ${normStatus === 'Rejected' ? 'selected' : ''}>Rejected</option>
        </select>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; font-size: 0.82rem;">
      <div><strong>Email:</strong> ${email !== 'N/A' ? `<a href="mailto:${escapeHtml(email)}" style="color: #0284c7;">${escapeHtml(email)}</a>` : 'N/A'}</div>
      <div><strong>Phone:</strong> ${escapeHtml(phone)}</div>
    </div>
    <p style="margin-bottom: 12px; font-size: 0.82rem;"><strong>Portfolio / Profile:</strong> ${portfolio ? `<a href="${escapeHtml(portfolio)}" target="_blank" style="color: #0284c7;">${escapeHtml(portfolio)} ↗</a>` : '<span style="color: #94a3b8;">None provided</span>'}</p>
    
    <p style="margin-top: 12px; margin-bottom: 4px; font-size: 0.8rem;"><strong>Applicant Cover Note:</strong></p>
    <div style="background: #f8fafc; border: 1px solid var(--border-light); border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; font-style: italic; color: #334155; font-size: 0.82rem;">
      "${escapeHtml(note)}"
    </div>

    <div style="background: #f8fafc; border: 1px solid #bae6fd; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <label for="modal-app-notes" style="font-weight: 600; color: #0284c7; font-size: 0.8rem; margin: 0; display: flex; align-items: center; gap: 6px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
          Internal Recruiter / Interviewer Notes
        </label>
        <button type="button" id="btn-save-app-notes" class="btn-table-action" style="padding: 3px 8px; font-size: 0.74rem; border-color: #bae6fd; color: #0284c7; background: #ffffff;" onclick="window.saveAppNotes('${app.id}')">Save Notes</button>
      </div>
      <textarea id="modal-app-notes" rows="3" class="form-input" style="width: 100%; font-size: 0.8rem; padding: 8px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; color: #0f172a; resize: vertical;" placeholder="Add private feedback, screening notes, interview scores or timeline...">${escapeHtml(internalNotes)}</textarea>
    </div>

    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
      ${resume ? `<a href="${escapeHtml(resume)}" target="_blank" class="btn-primary-action" style="display: inline-block; text-decoration: none;">Download / Open Resume Document ↗</a>` : ''}
      <button type="button" class="btn-table-action delete" style="padding: 6px 12px; font-weight: 600; margin-left: auto;" onclick="window.deleteApplicationPermanently('${app.id}'); window.closeModal('modal-view-app');">Delete Application</button>
    </div>
  `;
  openModal('modal-view-app');
};

/* ==========================================================================
   SAAS IDEA PITCHES INBOX
   ========================================================================== */

function renderIdeasTable() {
  const tbody = document.getElementById('ideas-table-body');
  if (!tbody) return;

  const searchInput = document.getElementById('search-ideas-input');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  const filtered = currentIdeas.filter(idea => {
    if (!query) return true;
    const concept = (idea.conceptName || '').toLowerCase();
    const founder = (idea.founderName || '').toLowerCase();
    const email = (idea.founderEmail || '').toLowerCase();
    const stage = (idea.stage || '').toLowerCase();
    const pitch = (idea.elevatorPitch || '').toLowerCase();
    const type = (idea.productType || '').toLowerCase();
    return concept.includes(query) || founder.includes(query) || email.includes(query) || stage.includes(query) || pitch.includes(query) || type.includes(query);
  });

  const countMeta = document.getElementById('ideas-results-count');
  if (countMeta) {
    countMeta.textContent = `Showing ${filtered.length} of ${currentIdeas.length}`;
  }

  if (filtered.length === 0) {
    const msg = currentIdeas.length === 0 ? 'No SaaS ideas submitted yet.' : 'No pitches match your search criteria.';
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 32px 16px;">${msg}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(idea => `
    <tr>
      <td><strong style="color: #0f172a;">${escapeHtml(idea.conceptName)}</strong></td>
      <td>
        <div>${escapeHtml(idea.founderName)}</div>
        <div style="font-size: 0.74rem; color: #64748b;">${escapeHtml(idea.founderEmail)}</div>
      </td>
      <td><span class="badge amber">${idea.stage}</span></td>
      <td style="max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(idea.elevatorPitch || '')}</td>
      <td style="font-size: 0.76rem; color: #64748b;">${formatDateTime(idea.submittedAt || idea.createdAt)}</td>
      <td style="white-space: nowrap;">
        <button class="btn-table-action" onclick="window.viewIdea('${idea.id}')">View Pitch</button>
        <button class="btn-table-action delete" style="margin-left: 4px;" onclick="window.deleteIdea('${idea.id}')" title="Permanently Delete Idea from Firebase">Delete</button>
      </td>
    </tr>
  `).join('');
}

const searchIdeasInput = document.getElementById('search-ideas-input');
if (searchIdeasInput) {
  searchIdeasInput.addEventListener('input', () => {
    renderIdeasTable();
  });
}

window.viewIdea = (id) => {
  const idea = currentIdeas.find(i => i.id === id);
  if (!idea) return;
  const body = document.getElementById('view-idea-body');
  body.innerHTML = `
    <h4 style="color: #0f172a; font-size: 1.15rem; margin-bottom: 2px;">${escapeHtml(idea.conceptName)}</h4>
    <div style="color: #0284c7; font-size: 0.82rem; margin-bottom: 14px;">
      Founder: ${escapeHtml(idea.founderName)} &bull; <a href="mailto:${idea.founderEmail}" style="color: #0284c7;">${escapeHtml(idea.founderEmail)}</a>
      ${idea.background ? `<div style="font-size: 0.76rem; color: #64748b; margin-top: 2px;">Background: ${escapeHtml(idea.background)}</div>` : ''}
    </div>
    
    <div style="display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap;">
      <span class="badge amber">Stage: ${escapeHtml(idea.stage || 'Concept')}</span>
      ${idea.productType ? `<span class="badge cyan">Type: ${escapeHtml(idea.productType)}</span>` : ''}
      <span class="badge emerald">Terms Agreed: ✓</span>
    </div>

    <p style="margin-top: 8px; font-size: 0.82rem;"><strong>Core Problem:</strong><br />${escapeHtml(idea.problem)}</p>
    <p style="margin-top: 8px; font-size: 0.82rem;"><strong>Proposed Solution:</strong><br />${escapeHtml(idea.solution)}</p>
    ${idea.targetAudience ? `<p style="margin-top: 8px; font-size: 0.82rem;"><strong>Target Audience / Users:</strong><br />${escapeHtml(idea.targetAudience)}</p>` : ''}
    ${idea.successReason ? `<p style="margin-top: 8px; font-size: 0.82rem;"><strong>Why it could succeed (Potential):</strong><br />${escapeHtml(idea.successReason)}</p>` : ''}
    ${idea.additionalContext ? `<p style="margin-top: 8px; font-size: 0.82rem;"><strong>Additional Context / Links:</strong><br />${escapeHtml(idea.additionalContext)}</p>` : ''}
    ${idea.deckUrl ? `<p style="margin-top: 12px; font-size: 0.82rem;"><strong>Deck / Prototype:</strong> <a href="${idea.deckUrl}" target="_blank" style="color: #0284c7;">${escapeHtml(idea.deckUrl)} ↗</a></p>` : ''}
    
    <div style="margin-top: 20px; display: flex; gap: 8px; align-items: center; justify-content: flex-end; flex-wrap: wrap;">
      <button type="button" class="btn-table-action delete" style="padding: 6px 12px; font-weight: 600;" onclick="window.deleteIdea('${idea.id}'); window.closeModal('modal-view-idea');">Delete Pitch</button>
      <a href="mailto:${idea.founderEmail}?subject=Re:%20Synerbit%20Incubation%20Proposal%20-%20${encodeURIComponent(idea.conceptName)}" class="btn-primary-action" style="display: inline-block; text-decoration: none;">Reply to Founder via Email ✉️</a>
    </div>
  `;
  openModal('modal-view-idea');
};

// Permanently Delete SaaS Idea from Firebase
window.deleteIdea = async (id) => {
  const idea = currentIdeas.find(i => i.id === id);
  if (!confirm(`Are you sure you want to permanently delete idea pitch "${idea?.conceptName || 'Pitch'}" from Firebase backend?`)) return;

  currentIdeas = currentIdeas.filter(i => i.id !== id);
  updateAllUIPanels();

  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const fbApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(fbApp);

      await Promise.allSettled([
        deleteDoc(doc(db, "idea_submissions", id)),
        deleteDoc(doc(db, "ideas", id))
      ]);
    } catch (err) {
      console.warn("Firestore delete idea error:", err);
    }
  }
};

/* ==========================================================================
   CONTACT MESSAGES
   ========================================================================== */

function renderContactsTable() {
  const tbody = document.getElementById('contacts-table-body');
  if (!tbody) return;

  const searchInput = document.getElementById('search-contacts-input');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  const filtered = currentContacts.filter(c => {
    if (!query) return true;
    const name = (c.name || '').toLowerCase();
    const email = (c.email || '').toLowerCase();
    const subject = (c.subject || '').toLowerCase();
    const message = (c.message || '').toLowerCase();
    return name.includes(query) || email.includes(query) || subject.includes(query) || message.includes(query);
  });

  if (filtered.length === 0) {
    const msg = currentContacts.length === 0 ? 'No contact messages yet.' : 'No messages match your search criteria.';
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #64748b; padding: 32px 16px;">${msg}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(c => {
    const isRead = !!c.isRead;
    const statusBadge = isRead
      ? `<span class="read-badge">Read</span>`
      : `<span class="unread-badge"><span class="unread-dot"></span> New</span>`;
    const toggleLabel = isRead ? 'Mark Unread' : 'Mark Read';

    return `
      <tr>
        <td>${statusBadge}</td>
        <td><strong style="color: #0f172a;">${escapeHtml(c.name || 'Anonymous')}</strong></td>
        <td><a href="mailto:${escapeHtml(c.email)}" style="color: #0284c7; text-decoration: underline;" title="Reply to ${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></td>
        <td><span style="font-weight: 600; color: #334155;">${escapeHtml(c.subject || 'General Inquiry')}</span></td>
        <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #334155;" title="${escapeHtml(c.message)}">${escapeHtml(c.message)}</td>
        <td style="font-size: 0.76rem; color: #64748b; white-space: nowrap;">${formatDateTime(c.submittedAt || c.createdAt)}</td>
        <td style="white-space: nowrap;">
          <button class="btn-table-action" onclick="window.viewContact('${c.id}')">View</button>
          <button class="btn-table-action" style="color: #64748b; font-size: 0.72rem;" onclick="window.toggleContactRead('${c.id}')" title="${toggleLabel}">${toggleLabel}</button>
          <a href="mailto:${encodeURIComponent(c.email)}?subject=Re:%20${encodeURIComponent(c.subject || 'Synerbit Inquiry')}" class="btn-table-action" style="text-decoration: none; display: inline-block;">Reply ✉️</a>
          <button class="btn-table-action delete" onclick="window.deleteContact('${c.id}')" title="Delete">✕</button>
        </td>
      </tr>
    `;
  }).join('');
}

const searchContactsInput = document.getElementById('search-contacts-input');
if (searchContactsInput) {
  searchContactsInput.addEventListener('input', () => {
    renderContactsTable();
  });
}

const btnMarkAllContactsRead = document.getElementById('btn-mark-all-contacts-read');
if (btnMarkAllContactsRead) {
  btnMarkAllContactsRead.addEventListener('click', async () => {
    const unread = currentContacts.filter(c => !c.isRead);
    if (unread.length === 0) return;

    btnMarkAllContactsRead.disabled = true;
    btnMarkAllContactsRead.textContent = 'Updating...';

    currentContacts.forEach(c => c.isRead = true);
    setLocal('contacts', currentContacts);
    updateAllUIPanels();

    if (isFirebaseConfigured()) {
      try {
        const { getFirestore, doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
        const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
        const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
        const db = getFirestore(app);
        await Promise.all(unread.map(c => setDoc(doc(db, "contact_messages", c.id), { isRead: true }, { merge: true })));
      } catch (err) {
        console.warn("Bulk mark read error:", err);
      }
    }

    btnMarkAllContactsRead.textContent = 'All Read ✓';
    setTimeout(() => {
      btnMarkAllContactsRead.textContent = 'Mark All Read';
      btnMarkAllContactsRead.disabled = false;
    }, 1500);
  });
}

window.toggleContactRead = async (id) => {
  const contact = currentContacts.find(c => c.id === id);
  if (!contact) return;
  contact.isRead = !contact.isRead;
  setLocal('contacts', currentContacts);
  updateAllUIPanels();

  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(app);
      await setDoc(doc(db, "contact_messages", id), { isRead: contact.isRead }, { merge: true });
      try {
        await setDoc(doc(db, "contacts", id), { isRead: contact.isRead }, { merge: true });
      } catch (_) {}
    } catch (err) {
      console.warn("Could not toggle read status in Firestore:", err);
    }
  }
};

window.viewContact = async (id) => {
  const contact = currentContacts.find(c => c.id === id);
  if (!contact) return;

  // Automatically mark as read if not already read
  if (!contact.isRead) {
    contact.isRead = true;
    setLocal('contacts', currentContacts);
    updateAllUIPanels();

    if (isFirebaseConfigured()) {
      try {
        const { getFirestore, doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
        const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
        const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
        const db = getFirestore(app);
        await setDoc(doc(db, "contact_messages", id), { isRead: true }, { merge: true });
        try {
          await setDoc(doc(db, "contacts", id), { isRead: true }, { merge: true });
        } catch (_) {}
      } catch (err) {
        console.warn("Could not mark message as read in Firestore:", err);
      }
    }
  }

  const body = document.getElementById('view-contact-body');
  if (body) {
    body.innerHTML = `
      <div style="border-bottom: 1px solid var(--border-light); padding-bottom: 10px; margin-bottom: 14px;">
        <h4 style="color: #0f172a; font-size: 1.15rem; margin-bottom: 2px;">${escapeHtml(contact.name || 'Anonymous')}</h4>
        <div style="color: #0284c7; font-size: 0.82rem;">
          <a href="mailto:${escapeHtml(contact.email)}" style="color: #0284c7; text-decoration: underline;">${escapeHtml(contact.email)}</a>
          &bull; <span style="color: #64748b;">${formatDateTime(contact.submittedAt || contact.createdAt)}</span>
        </div>
      </div>
      
      <p style="margin-bottom: 8px; font-size: 0.82rem;"><strong>Subject:</strong> <span style="color: #0f172a;">${escapeHtml(contact.subject || 'General Inquiry')}</span></p>
      <p style="margin-bottom: 6px; font-size: 0.8rem;"><strong>Message Content:</strong></p>
      <div style="background: #f8fafc; border: 1px solid var(--border-light); border-radius: 8px; padding: 12px; line-height: 1.6; color: #334155; white-space: pre-wrap; font-size: 0.85rem;">${escapeHtml(contact.message)}</div>
      
      <div style="margin-top: 20px; display: flex; gap: 8px; justify-content: flex-end;">
        <button type="button" class="btn-table-action delete" style="padding: 6px 12px;" onclick="window.deleteContact('${contact.id}'); window.closeModal('modal-view-contact');">Delete Message</button>
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

function getInitials(nameOrEmail) {
  if (!nameOrEmail) return 'U';
  const clean = nameOrEmail.trim();
  const parts = clean.split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

function getAvatarGradient(seed) {
  const gradients = [
    'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
    'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)',
    'linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)',
    'linear-gradient(135deg, #10b981 0%, #0284c7 100%)',
    'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)'
  ];
  let hash = 0;
  for (let i = 0; i < (seed || '').length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % gradients.length;
  return gradients[idx];
}

function renderTeamTable() {
  const tbody = document.getElementById('team-table-body');
  const displayTeam = deduplicateTeam(currentTeam);
  if (displayTeam.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 36px 20px;"><div style="font-size: 0.9rem; font-weight: 600; color: #0f172a; margin-bottom: 4px;">No team members found</div><div style="font-size: 0.78rem; color: #64748b;">Add members above to grant access to the Admin Console.</div></td></tr>';
    return;
  }

  tbody.innerHTML = displayTeam.map(member => {
    const isSuper = isSuperAdminEmail(member.email) || member.isSuperAdmin === true;
    const p = member.permissions || {};
    const name = member.name || (isSuper ? 'Super Admin' : 'Team Member');
    const email = member.email || '';
    const avatarGrad = getAvatarGradient(name + email);
    const initials = getInitials(name);

    // Module Permissions Cell
    let permsContent = '';
    if (isSuper) {
      permsContent = `
        <div class="perm-chips-wrap">
          <span class="perm-chip-all" title="Full unrestricted access to all console modules">
            <svg class="perm-chip-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
            <span>Full Access &bull; All Modules</span>
          </span>
        </div>
      `;
    } else {
      const activePerms = [];
      if (p.products) activePerms.push('Products');
      if (p.jobs) activePerms.push('Jobs');
      if (p.applications) activePerms.push('Applications');
      if (p.ideas) activePerms.push('Ideas');
      if (p.contacts) activePerms.push('Contacts');
      if (p.team) activePerms.push('Team & Roles');

      if (activePerms.length === 6) {
        permsContent = `
          <div class="perm-chips-wrap">
            <span class="perm-chip-all" title="Full unrestricted access to all console modules">
              <svg class="perm-chip-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
              <span>Full Access &bull; All Modules</span>
            </span>
          </div>
        `;
      } else if (activePerms.length === 0) {
        permsContent = '<span class="perm-none">No permissions assigned</span>';
      } else {
        permsContent = `
          <div class="perm-chips-wrap">
            ${activePerms.map(label => `<span class="perm-chip">${escapeHtml(label)}</span>`).join('')}
          </div>
        `;
      }
    }

    // Role Title Badge
    const roleBadge = isSuper ? `
      <span class="role-badge role-super-admin">
        <svg class="role-badge-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clip-rule="evenodd"/></svg>
        <span>Super Admin</span>
      </span>
    ` : `
      <span class="role-badge role-member">
        <span class="role-status-dot"></span>
        <span>${escapeHtml(member.role || 'Member')}</span>
      </span>
    `;

    // Date
    const formattedDate = member.createdAt 
      ? new Date(member.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      : (member.updatedAt ? new Date(member.updatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Active');

    // Action Cell
    const actionCell = isSuper ? `
      <span class="team-protected-badge">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
        <span>Protected Super Admin</span>
      </span>
    ` : `
      <div class="team-actions-wrap">
        <button class="btn-team-action edit" onclick="window.editMember('${member.id}')" title="Edit Permissions">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          <span>Edit</span>
        </button>
        <button class="btn-team-action delete" onclick="window.deleteMember('${member.id}')" title="Remove Member">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          <span>Remove</span>
        </button>
      </div>
    `;

    return `
      <tr class="team-table-row ${isSuper ? 'row-super-admin' : ''}">
        <td>
          <div class="team-user-cell">
            <div class="team-user-avatar" style="background: ${avatarGrad};">
              ${initials}
            </div>
            <div class="team-user-meta">
              <span class="team-user-name">${escapeHtml(name)}</span>
              ${isSuper ? '<span class="team-user-subtag">Owner &bull; Full Privileges</span>' : '<span class="team-user-subtag">Team Member</span>'}
            </div>
          </div>
        </td>
        <td>
          <a href="mailto:${escapeHtml(email)}" class="team-email-link" title="${escapeHtml(email)}">
            <svg class="team-email-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z"/><path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z"/></svg>
            <span>${escapeHtml(email)}</span>
          </a>
        </td>
        <td>${roleBadge}</td>
        <td>${permsContent}</td>
        <td>
          <div class="team-date-cell">
            <svg class="team-date-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd"/></svg>
            <span>${formattedDate}</span>
          </div>
        </td>
        <td>${actionCell}</td>
      </tr>
    `;
  }).join('');
}

document.getElementById('btn-open-add-member').addEventListener('click', () => {
  document.getElementById('team-form').reset();
  document.getElementById('team-user-id').value = '';
  document.getElementById('team-password-label').textContent = 'Password *';
  const pwdInput = document.getElementById('team-user-password');
  if (pwdInput) {
    pwdInput.required = true;
    pwdInput.value = '';
  }
  const pwdHint = document.getElementById('team-password-hint');
  if (pwdHint) {
    pwdHint.textContent = 'Member will use this email & password to sign in to the Console.';
  }
  if (document.getElementById('perm-team')) {
    document.getElementById('perm-team').checked = false;
  }
  document.getElementById('team-modal-title').textContent = 'Add Team Member & Assign Access';
  openModal('modal-team');
});

document.getElementById('team-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const idInput = document.getElementById('team-user-id').value.trim();
  let id = idInput || `member-${Date.now()}`;
  const name = document.getElementById('team-user-name').value.trim();
  const email = document.getElementById('team-user-email').value.trim().toLowerCase();
  const role = document.getElementById('team-user-role').value.trim();
  const password = document.getElementById('team-user-password') ? document.getElementById('team-user-password').value : '';

  // Prevent modifying or hijacking Super Admin accounts via the UI
  if (isSuperAdminEmail(email)) {
    alert('Super Admin accounts (rajeev@synerbit.in and admin@synerbit.in) are permanent and cannot be modified.');
    closeModal('modal-team');
    return;
  }

  // Validate password for new user
  if (!idInput && (!password || password.length < 6)) {
    alert('Please provide a password with at least 6 characters for the new member.');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving Member & Provisioning...';
  }

  const member = {
    id,
    name,
    email,
    role,
    isSuperAdmin: false,
    permissions: {
      products: document.getElementById('perm-products').checked,
      jobs: document.getElementById('perm-jobs').checked,
      applications: document.getElementById('perm-applications').checked,
      ideas: document.getElementById('perm-ideas').checked,
      contacts: document.getElementById('perm-contacts').checked,
      team: document.getElementById('perm-team') ? document.getElementById('perm-team').checked : false
    },
    updatedAt: new Date().toISOString()
  };
  if (!idInput) {
    member.createdAt = new Date().toISOString();
  }

  // 1. Provision / Create user in Firebase Authentication using isolated secondary app
  // This ensures the current admin's active session is never interrupted or signed out!
  if (password && isFirebaseConfigured()) {
    try {
      const { initializeApp, deleteApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const { getAuth, createUserWithEmailAndPassword } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
      const tempAppName = `team-auth-worker-${Date.now()}`;
      const tempApp = initializeApp(firebaseConfig, tempAppName);
      const tempAuth = getAuth(tempApp);
      try {
        const cred = await createUserWithEmailAndPassword(tempAuth, email, password);
        if (!idInput && cred.user && cred.user.uid) {
          member.id = cred.user.uid;
          id = cred.user.uid;
        }
      } catch (authErr) {
        if (authErr.code === 'auth/email-already-in-use') {
          console.log("Firebase Auth account already exists for this email; updating Firestore profile.");
        } else {
          console.warn("Firebase Auth provisioning notice:", authErr);
        }
      } finally {
        await deleteApp(tempApp);
      }
    } catch (fbErr) {
      console.warn("Could not provision secondary Firebase Auth user:", fbErr);
    }
  }

  // 2. Persist team profile to Firestore collection 'team'
  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(app);
      await setDoc(doc(db, "team", member.id), member, { merge: true });
    } catch (err) {
      console.warn("Could not save team member to Firestore:", err);
    }
  }

  // 3. Update local state & render table
  const existingIdx = currentTeam.findIndex(m => m.id === member.id || (m.email || '').toLowerCase() === member.email.toLowerCase());
  if (existingIdx >= 0) {
    currentTeam[existingIdx] = { ...currentTeam[existingIdx], ...member };
  } else {
    currentTeam.push(member);
  }

  setLocal('team', currentTeam);
  closeModal('modal-team');
  renderTeamTable();

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save User Permissions';
  }
});

window.editMember = (id) => {
  const m = currentTeam.find(x => x.id === id);
  if (!m) return;
  if (isSuperAdminEmail(m.email) || m.isSuperAdmin) {
    alert('Super Admin accounts (rajeev@synerbit.in and admin@synerbit.in) are permanent and cannot be modified.');
    return;
  }
  document.getElementById('team-user-id').value = m.id;
  document.getElementById('team-user-name').value = m.name;
  document.getElementById('team-user-email').value = m.email;
  document.getElementById('team-user-role').value = m.role;

  document.getElementById('team-password-label').textContent = 'New Password (Optional)';
  const pwdInput = document.getElementById('team-user-password');
  if (pwdInput) {
    pwdInput.required = false;
    pwdInput.value = '';
  }
  const pwdHint = document.getElementById('team-password-hint');
  if (pwdHint) {
    pwdHint.textContent = 'Leave blank to keep existing password, or enter new password to reset.';
  }

  const p = m.permissions || {};
  document.getElementById('perm-products').checked = !!p.products;
  document.getElementById('perm-jobs').checked = !!p.jobs;
  document.getElementById('perm-applications').checked = !!p.applications;
  document.getElementById('perm-ideas').checked = !!p.ideas;
  document.getElementById('perm-contacts').checked = !!p.contacts;
  if (document.getElementById('perm-team')) {
    document.getElementById('perm-team').checked = !!(p.team || m.isSuperAdmin);
  }
  document.getElementById('team-modal-title').textContent = 'Edit Member Permissions';
  openModal('modal-team');
};

window.deleteMember = async (id) => {
  const targetMember = currentTeam.find(m => m.id === id);
  if (targetMember && (isSuperAdminEmail(targetMember.email) || targetMember.isSuperAdmin)) {
    alert('Super Admin accounts (rajeev@synerbit.in and admin@synerbit.in) are permanent and cannot be removed.');
    return;
  }
  if (!confirm('Are you sure you want to remove this team member?')) return;
  currentTeam = currentTeam.filter(m => m.id !== id);
  try { localStorage.removeItem('synerbit_team'); } catch (_) {}
  renderTeamTable();

  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, doc, deleteDoc, collection, query, where, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(app);

      // 1. Delete by document ID
      await deleteDoc(doc(db, "team", id)).catch(() => {});

      // 2. Delete by email document ID if applicable
      if (targetMember && targetMember.email) {
        const normTargetEmail = targetMember.email.toLowerCase().trim();
        await deleteDoc(doc(db, "team", normTargetEmail)).catch(() => {});

        // 3. Query and delete all documents in 'team' matching this email
        try {
          const q = query(collection(db, "team"), where("email", "==", normTargetEmail));
          const snap = await getDocs(q);
          for (const d of snap.docs) {
            await deleteDoc(doc(db, "team", d.id)).catch(() => {});
          }
        } catch (_) {}
      }
    } catch (err) {
      console.warn("Could not remove team member from Firestore:", err);
    }
  }
};

// Sync live backend button listener
const btnSyncTeam = document.getElementById('btn-sync-cloud-team');
if (btnSyncTeam) {
  btnSyncTeam.addEventListener('click', async () => {
    btnSyncTeam.disabled = true;
    btnSyncTeam.textContent = 'Syncing...';
    try {
      localStorage.removeItem('synerbit_team');
      if (isFirebaseConfigured()) {
        const { getFirestore, collection, getDocsFromServer, getDocs, setDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
        const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
        const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
        const db = getFirestore(app);
        let snap;
        try {
          snap = await getDocsFromServer(collection(db, "team"));
        } catch (_) {
          snap = await getDocs(collection(db, "team"));
        }
        let fetchedTeam = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Ensure permanent Super Admins are kept
        for (const adminDef of PERMANENT_SUPER_ADMINS) {
          const found = fetchedTeam.find(m => (m.email || '').toLowerCase().trim() === adminDef.email);
          if (!found) {
            fetchedTeam.unshift(adminDef);
            await setDoc(doc(db, "team", adminDef.id), adminDef, { merge: true }).catch(() => {});
          } else {
            found.isSuperAdmin = true;
            found.role = 'Super Admin';
            found.permissions = { products: true, jobs: true, applications: true, ideas: true, contacts: true, team: true };
          }
        }

        currentTeam = fetchedTeam;
      } else {
        currentTeam = [...PERMANENT_SUPER_ADMINS];
      }
      renderTeamTable();
    } catch (err) {
      console.warn("Sync cloud team warning:", err);
    } finally {
      btnSyncTeam.disabled = false;
      btnSyncTeam.textContent = '🔄 Sync Live Backend';
    }
  });
}

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
