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
['synerbit_applications', 'synerbit_deleted_applications', 'synerbit_ideas', 'synerbit_contacts', 'synerbit_products', 'synerbit_jobs', 'synerbit_team', 'synerbit_issued_docs'].forEach(k => {
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
      team: true,
      certificates: true
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
      team: true,
      certificates: true
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
  team: { title: 'Team & Role Permissions', desc: 'Grant or restrict module-level permissions for console users.' },
  certificates: { title: 'Certificates & Letters', desc: 'Generate, preview, and print official offer letters and completion certificates.' }
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
  const tabCertificates = document.getElementById('tab-btn-certificates');

  if (tabProducts) tabProducts.style.display = hasPermission('products') ? 'flex' : 'none';
  if (tabJobs) tabJobs.style.display = hasPermission('jobs') ? 'flex' : 'none';
  if (tabApps) tabApps.style.display = hasPermission('applications') ? 'flex' : 'none';
  if (tabIdeas) tabIdeas.style.display = hasPermission('ideas') ? 'flex' : 'none';
  if (tabContacts) tabContacts.style.display = hasPermission('contacts') ? 'flex' : 'none';
  const canSeeCertificates = hasPermission('certificates') || isSuper;
  const canSeeTeam = hasPermission('team') || isSuper;
  if (tabCertificates) tabCertificates.style.display = canSeeCertificates ? 'flex' : 'none';
  if (tabTeam) tabTeam.style.display = canSeeTeam ? 'flex' : 'none';
  if (teamSection) teamSection.style.display = (canSeeCertificates || canSeeTeam) ? 'block' : 'none';

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

  import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js").then(({ collection, doc, onSnapshot }) => {
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
              foundAdmin.permissions = { products: true, jobs: true, applications: true, ideas: true, contacts: true, certificates: true, team: true };
            }
          }

          currentTeam = deduplicateTeam(liveTeam);
          renderTeamTable();
        }
      }, err => console.warn("Live team listener note:", err));
      realtimeUnsubscribes.push(unsubTeam);
    } catch (_) {}

    // 7. Site Analytics (GA4) Listener
    try {
      const unsubAnalytics = onSnapshot(doc(db, "site_analytics", "overview"), (snap) => {
        if (snap.exists()) {
          renderSiteAnalytics(snap.data());
        } else {
          renderSiteAnalytics(null);
        }
      }, err => {
        console.warn("Analytics listener note:", err);
        renderSiteAnalytics(null);
      });
      realtimeUnsubscribes.push(unsubAnalytics);
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
  if (typeof populateCertCandidateDropdown === 'function') populateCertCandidateDropdown();
  if (typeof renderCertArchiveTable === 'function') renderCertArchiveTable();
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
      const { getFirestore, collection, getDocs, getDoc, doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
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
            found.permissions = { products: true, jobs: true, applications: true, ideas: true, contacts: true, certificates: true, team: true };
          }
        }

        currentTeam = deduplicateTeam(fetchedTeam.length > 0 ? fetchedTeam : PERMANENT_SUPER_ADMINS);
      } catch (err) {
        console.warn("Team members sync issue:", err);
      }

      // 7. Fetch Site Analytics (GA4) Overview
      try {
        const analyticsSnap = await getDoc(doc(db, "site_analytics", "overview"));
        if (analyticsSnap && analyticsSnap.exists()) {
          renderSiteAnalytics(analyticsSnap.data());
        } else {
          renderSiteAnalytics(null);
        }
      } catch (err) {
        console.warn("Site analytics sync issue:", err);
        renderSiteAnalytics(null);
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

function renderSiteAnalytics(data) {
  const usersEl = document.getElementById('ga-active-users');
  const viewsEl = document.getElementById('ga-page-views');
  const sessionsEl = document.getElementById('ga-sessions');
  const engRateEl = document.getElementById('ga-engagement-rate');
  const syncedEl = document.getElementById('ga-last-synced');
  const sourcesEl = document.getElementById('ga-sources-list');
  const pagesEl = document.getElementById('ga-pages-list');

  if (!usersEl) return;

  if (!data) {
    usersEl.textContent = '—';
    viewsEl.textContent = '—';
    sessionsEl.textContent = '—';
    engRateEl.textContent = '—';
    if (syncedEl) syncedEl.textContent = 'Awaiting sync';
    if (sourcesEl) sourcesEl.innerHTML = '<div class="recent-list-empty">Awaiting Google Analytics sync data.</div>';
    if (pagesEl) pagesEl.innerHTML = '<div class="recent-list-empty">Awaiting Google Analytics sync data.</div>';
    return;
  }

  // Format KPIs
  usersEl.textContent = (typeof data.activeUsers === 'number') ? data.activeUsers.toLocaleString() : (data.activeUsers || '0');
  viewsEl.textContent = (typeof data.pageViews === 'number') ? data.pageViews.toLocaleString() : (data.pageViews || '0');
  sessionsEl.textContent = (typeof data.sessions === 'number') ? data.sessions.toLocaleString() : (data.sessions || '0');

  if (data.engagementRate) {
    engRateEl.textContent = data.engagementRate;
  } else if (data.bounceRate) {
    const br = parseFloat(data.bounceRate);
    engRateEl.textContent = !isNaN(br) ? `${(100 - br).toFixed(1)}%` : '—';
  } else {
    engRateEl.textContent = '—';
  }

  if (syncedEl) {
    if (data.lastSyncedAt) {
      syncedEl.textContent = `Last synced: ${formatDateTime(data.lastSyncedAt)}`;
    } else {
      syncedEl.textContent = 'Active Telemetry';
    }
  }

  // Top Sources
  if (sourcesEl) {
    const sources = Array.isArray(data.topSources) ? data.topSources : [];
    if (sources.length === 0) {
      sourcesEl.innerHTML = '<div class="recent-list-empty">No source data recorded yet.</div>';
    } else {
      const maxSessions = Math.max(...sources.map(s => Number(s.sessions) || 1), 1);
      sourcesEl.innerHTML = sources.map(s => {
        const count = Number(s.sessions) || 0;
        const percent = Math.min(100, Math.max(8, Math.round((count / maxSessions) * 100)));
        return `
          <div style="margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; margin-bottom: 4px;">
              <span style="font-weight: 600; color: #0f172a;">${escapeHtml(s.source || '(direct)')}</span>
              <span style="font-family: var(--font-mono); color: #64748b; font-size: 0.74rem;">${count.toLocaleString()} sessions</span>
            </div>
            <div style="height: 6px; border-radius: 3px; background: #f1f5f9; overflow: hidden;">
              <div style="height: 100%; border-radius: 3px; background: linear-gradient(90deg, #0284c7, #38bdf8); width: ${percent}%;"></div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // Top Pages
  if (pagesEl) {
    const pages = Array.isArray(data.topPages) ? data.topPages : [];
    if (pages.length === 0) {
      pagesEl.innerHTML = '<div class="recent-list-empty">No pageview data recorded yet.</div>';
    } else {
      const maxViews = Math.max(...pages.map(p => Number(p.views) || 1), 1);
      pagesEl.innerHTML = pages.map(p => {
        const count = Number(p.views) || 0;
        const percent = Math.min(100, Math.max(8, Math.round((count / maxViews) * 100)));
        const path = p.path || '/';
        return `
          <div style="margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; margin-bottom: 4px;">
              <span style="font-weight: 600; color: #0f172a; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(path)}">${escapeHtml(path)}</span>
              <span style="font-family: var(--font-mono); color: #64748b; font-size: 0.74rem;">${count.toLocaleString()} views</span>
            </div>
            <div style="height: 6px; border-radius: 3px; background: #f1f5f9; overflow: hidden;">
              <div style="height: 100%; border-radius: 3px; background: linear-gradient(90deg, #10b981, #34d399); width: ${percent}%;"></div>
            </div>
          </div>
        `;
      }).join('');
    }
  }
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
      if (p.certificates) activePerms.push('Certificates');
      if (p.team) activePerms.push('Team & Roles');

      if (activePerms.length === 7) {
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
  if (document.getElementById('perm-certificates')) {
    document.getElementById('perm-certificates').checked = false;
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
      certificates: document.getElementById('perm-certificates') ? document.getElementById('perm-certificates').checked : false,
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
  if (document.getElementById('perm-certificates')) {
    document.getElementById('perm-certificates').checked = !!(p.certificates || m.isSuperAdmin);
  }
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
            found.permissions = { products: true, jobs: true, applications: true, ideas: true, contacts: true, certificates: true, team: true };
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

/* ==========================================================================
   CERTIFICATES & FORMAL LETTERS GENERATOR MODULE
   ========================================================================== */

let currentCertTemplate = 'intern_offer';
let issuedDocumentsList = [];
let activeEditingDocId = null;
let refIdValidationTimeout = null;

// Firebase Firestore helper
async function getFirestoreDb() {
  const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const { getFirestore } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return getFirestore(app);
}

// Date formatter for formal letters (e.g. 1st November 2026)
function formatCertDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const monthIdx = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const nth = (day > 3 && day < 21) ? 'th' : (['th', 'st', 'nd', 'rd', 'th'][Math.min(day % 10, 4)]);
      return `${day}${nth} ${months[monthIdx]} ${year}`;
    }
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const day = d.getDate();
      const month = d.toLocaleDateString('en-US', { month: 'long' });
      const year = d.getFullYear();
      const nth = (day > 3 && day < 21) ? 'th' : (['th', 'st', 'nd', 'rd', 'th'][Math.min(day % 10, 4)]);
      return `${day}${nth} ${month} ${year}`;
    }
    return dateStr;
  } catch (_) {
    return dateStr;
  }
}

// Check if a document reference ID already exists in Firebase
async function checkDocRefIdExistsInFirebase(refId, excludeDocId = null) {
  if (!refId || !refId.trim()) return false;
  const cleanRef = refId.trim().toUpperCase();
  try {
    const db = await getFirestoreDb();
    const { collection, query, where, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const q = query(collection(db, "issued_documents"), where("refId", "==", cleanRef));
    const snap = await getDocs(q);
    if (snap.empty) {
      return issuedDocumentsList.some(d => (d.refId || '').trim().toUpperCase() === cleanRef && d.id !== excludeDocId);
    }
    if (excludeDocId) {
      return snap.docs.some(d => d.id !== excludeDocId);
    }
    return true;
  } catch (err) {
    console.warn("Could not query Firebase for refId uniqueness, checking cache:", err);
    return issuedDocumentsList.some(d => (d.refId || '').trim().toUpperCase() === cleanRef && d.id !== excludeDocId);
  }
}

// Generate unique Ref ID by pre-fetching existing IDs from Firebase to guarantee non-collision
async function generateUniqueDocRefId(template) {
  const year = new Date().getFullYear();
  let prefix = 'SYN-DOC';
  if (template === 'intern_offer') prefix = 'SYN-INT';
  else if (template === 'fulltime_offer') prefix = 'SYN-FTE';
  else if (template === 'intern_completion') prefix = 'SYN-CERT';
  else if (template === 'relieving_letter') prefix = 'SYN-REL';

  // Fetch all existing reference IDs directly from Firebase Firestore backend
  const existingRefIds = new Set();
  try {
    const db = await getFirestoreDb();
    const { collection, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const snap = await getDocs(collection(db, "issued_documents"));
    snap.forEach(docSnap => {
      const data = docSnap.data();
      if (data && data.refId) {
        existingRefIds.add(data.refId.trim().toUpperCase());
      }
    });
  } catch (err) {
    console.warn("Could not fetch documents from Firebase, using memory list:", err);
    issuedDocumentsList.forEach(d => {
      if (d && d.refId) existingRefIds.add(d.refId.trim().toUpperCase());
    });
  }

  // Calculate next sequential integer starting at 1001 for this year and prefix
  let maxSeq = 1000;
  existingRefIds.forEach(id => {
    const parts = id.split('-');
    if (parts.length >= 4) {
      const idPrefix = `${parts[0]}-${parts[1]}`;
      const idYear = parts[2];
      const idSeq = parseInt(parts[3], 10);
      if (idPrefix === prefix && idYear === String(year) && !isNaN(idSeq)) {
        if (idSeq > maxSeq) maxSeq = idSeq;
      }
    }
  });

  let nextSeq = maxSeq + 1;
  let candidateId = `${prefix}-${year}-${nextSeq}`;

  // Loop to verify it strictly does NOT exist in existingRefIds
  while (existingRefIds.has(candidateId.toUpperCase())) {
    nextSeq++;
    candidateId = `${prefix}-${year}-${nextSeq}`;
  }

  return candidateId;
}

// Live debounced Ref ID validation badge update
async function updateRefIdValidationBadge(refId) {
  const badge = document.getElementById('cert-ref-status');
  if (!badge) return;

  if (!refId || !refId.trim()) {
    badge.className = 'badge gray';
    badge.textContent = '— Ref ID Required';
    return;
  }

  badge.className = 'badge blue';
  badge.textContent = '⏳ Checking Firebase...';

  clearTimeout(refIdValidationTimeout);
  refIdValidationTimeout = setTimeout(async () => {
    const exists = await checkDocRefIdExistsInFirebase(refId, activeEditingDocId);
    if (exists) {
      badge.className = 'badge red';
      badge.textContent = '⚠️ Already Exists in Firebase';
      badge.title = 'This Document Reference ID is already in use in Firebase.';
    } else {
      badge.className = 'badge emerald';
      badge.textContent = '✓ Verified Unique in Firebase';
      badge.title = 'Confirmed unique! This ID does not exist in Firebase.';
    }
  }, 350);
}

// Populate the Quick Auto-fill Dropdown from Candidate Applications
function populateCertCandidateDropdown() {
  const select = document.getElementById('cert-autofill-app');
  if (!select) return;
  const currentVal = select.value;
  select.innerHTML = '<option value="">Select candidate application to auto-fill...</option>';

  if (Array.isArray(currentApplications) && currentApplications.length > 0) {
    currentApplications.forEach(app => {
      const opt = document.createElement('option');
      opt.value = app.id;
      const appName = app.name || app.fullName || 'Candidate';
      const appRole = app.jobTitle || app.role || 'Applicant';
      opt.textContent = `${appName} — ${appRole} (${app.email || 'No email'})`;
      select.appendChild(opt);
    });
  }
  if (currentVal) select.value = currentVal;
}

// Update field visibility and labels based on active template
function updateCertTemplateFields(template) {
  currentCertTemplate = template;

  const badge = document.getElementById('cert-template-badge');
  const groupDeadline = document.getElementById('group-cert-deadline');
  const groupDuration = document.getElementById('group-cert-duration');
  const groupEndDate = document.getElementById('group-cert-end-date');
  const groupStipend = document.getElementById('group-cert-stipend');
  const groupRating = document.getElementById('group-cert-rating');
  const groupContributions = document.getElementById('group-cert-contributions');
  const groupResponsibilities = document.getElementById('group-cert-responsibilities');
  const groupExperienceWork = document.getElementById('group-cert-experience-work');
  const labelJoining = document.getElementById('label-cert-joining-date');
  const labelStipend = document.getElementById('label-cert-stipend');
  const inputStipend = document.getElementById('cert-input-stipend');

  if (badge) {
    const titles = {
      intern_offer: 'Intern Offer',
      fulltime_offer: 'Full-Time Offer',
      intern_completion: 'Internship Certificate',
      relieving_letter: 'Relieving & Experience'
    };
    badge.textContent = titles[template] || 'Document';
  }

  if (template === 'intern_offer') {
    if (groupDeadline) groupDeadline.style.display = 'block';
    if (groupDuration) groupDuration.style.display = 'block';
    if (groupEndDate) groupEndDate.style.display = 'none';
    if (groupStipend) groupStipend.style.display = 'block';
    if (groupRating) groupRating.style.display = 'none';
    if (groupContributions) groupContributions.style.display = 'none';
    if (groupResponsibilities) groupResponsibilities.style.display = 'none';
    if (groupExperienceWork) groupExperienceWork.style.display = 'none';
    if (labelJoining) labelJoining.textContent = 'Joining / Start Date *';
    if (labelStipend) labelStipend.textContent = 'Monthly Stipend';
    if (inputStipend && !inputStipend.value.includes('month')) inputStipend.value = '₹15,000 / month';
  } else if (template === 'fulltime_offer') {
    if (groupDeadline) groupDeadline.style.display = 'block';
    if (groupDuration) groupDuration.style.display = 'none';
    if (groupEndDate) groupEndDate.style.display = 'none';
    if (groupStipend) groupStipend.style.display = 'block';
    if (groupRating) groupRating.style.display = 'none';
    if (groupContributions) groupContributions.style.display = 'none';
    if (groupResponsibilities) groupResponsibilities.style.display = 'block';
    if (groupExperienceWork) groupExperienceWork.style.display = 'none';
    if (labelJoining) labelJoining.textContent = 'Joining / Start Date *';
    if (labelStipend) labelStipend.textContent = 'Annual CTC / Compensation';
    if (inputStipend && (inputStipend.value.includes('month') || !inputStipend.value)) inputStipend.value = '₹8,50,000 Per Annum';
  } else if (template === 'intern_completion') {
    if (groupDeadline) groupDeadline.style.display = 'none';
    if (groupDuration) groupDuration.style.display = 'block';
    if (groupEndDate) groupEndDate.style.display = 'block';
    if (groupStipend) groupStipend.style.display = 'none';
    if (groupRating) groupRating.style.display = 'block';
    if (groupContributions) groupContributions.style.display = 'block';
    if (groupResponsibilities) groupResponsibilities.style.display = 'none';
    if (groupExperienceWork) groupExperienceWork.style.display = 'none';
    if (labelJoining) labelJoining.textContent = 'Internship Start Date *';
  } else if (template === 'relieving_letter') {
    if (groupDeadline) groupDeadline.style.display = 'none';
    if (groupDuration) groupDuration.style.display = 'none';
    if (groupEndDate) groupEndDate.style.display = 'block';
    if (groupStipend) groupStipend.style.display = 'none';
    if (groupRating) groupRating.style.display = 'none';
    if (groupContributions) groupContributions.style.display = 'none';
    if (groupResponsibilities) groupResponsibilities.style.display = 'none';
    if (groupExperienceWork) groupExperienceWork.style.display = 'block';
    if (labelJoining) labelJoining.textContent = 'Employment Start Date *';
  }

  // Manage visibility and context-aware title of the Scope & Deliverables Section
  const sectionScope = document.getElementById('section-cert-scope');
  const titleScope = document.getElementById('title-cert-scope');
  if (sectionScope) {
    if (template === 'intern_offer') {
      sectionScope.style.display = 'none';
    } else {
      sectionScope.style.display = 'block';
      if (titleScope) {
        if (template === 'fulltime_offer') titleScope.textContent = 'Key Roles & Responsibilities';
        else if (template === 'intern_completion') titleScope.textContent = 'Contributions & Evaluation Remarks';
        else if (template === 'relieving_letter') titleScope.textContent = 'Scope of Work & Projects Delivered';
      }
    }
  }

  // Update Reference ID with unique ID from Firebase
  const refInput = document.getElementById('cert-input-ref-id');
  if (refInput && (!refInput.value || refInput.dataset.autoGenerated === 'true')) {
    refInput.placeholder = 'Fetching unique ID from Firebase...';
    generateUniqueDocRefId(template).then(uniqueId => {
      if (refInput && (!refInput.value || refInput.dataset.autoGenerated === 'true')) {
        refInput.value = uniqueId;
        refInput.dataset.autoGenerated = 'true';
        updateRefIdValidationBadge(uniqueId);
        renderCertPreview();
      }
    });
  }

  renderCertPreview();
}

// Standardized Document Nomenclature: [Type of Document] - [Name of Candidate] - [Reference Number]
function getDocTypeLabel(template) {
  const map = {
    intern_offer: 'Internship Offer Letter',
    fulltime_offer: 'Full-Time Offer Letter',
    intern_completion: 'Certificate of Completion',
    relieving_letter: 'Experience cum Relieving Letter'
  };
  return map[template] || 'Official Document';
}

function getDocNomenclature(template, candidateName, refId, format = 'standard') {
  const typeLabel = getDocTypeLabel(template);
  const cleanName = (candidateName || '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\[\]]/g, '')
    .replace(/[<>:"/\\|?*]/g, '')
    .trim() || 'Candidate';
  const cleanRef = (refId || 'REF')
    .replace(/[<>:"/\\|?*]/g, '')
    .trim();

  if (format === 'filename') {
    const slugType = typeLabel.replace(/[\s\-_]+/g, '_');
    const slugName = cleanName.replace(/[\s\-_]+/g, '_');
    const slugRef = cleanRef.replace(/[\s\-_]+/g, '_');
    return `${slugType}_${slugName}_${slugRef}`;
  }

  // Standard format: [Type of Document] - [Name of Candidate] - [Reference Number]
  return `${typeLabel} - ${cleanName} - ${cleanRef}`;
}

// Render the Live WYSIWYG A4 Preview Sheet
function renderCertPreview() {
  const sheet = document.getElementById('cert-preview-sheet');
  if (!sheet) return;

  const rawName = document.getElementById('cert-input-name')?.value.trim();
  const name = rawName ? escapeHtml(rawName) : '<span style="color: #94a3b8; font-style: italic;">[Recipient Full Name]</span>';
  const email = document.getElementById('cert-input-email')?.value.trim() || '';
  const role = document.getElementById('cert-input-role')?.value.trim() || 'Software Engineer Intern';
  const dept = document.getElementById('cert-input-dept')?.value.trim() || 'Engineering & Product';
  const offerDate = document.getElementById('cert-input-offer-date')?.value || '';
  const joiningDate = document.getElementById('cert-input-joining-date')?.value || '';
  const deadline = document.getElementById('cert-input-deadline')?.value || '';
  const duration = document.getElementById('cert-input-duration')?.value.trim() || '3 Months';
  const endDate = document.getElementById('cert-input-end-date')?.value || '';
  const stipend = document.getElementById('cert-input-stipend')?.value.trim() || '₹15,000 / month';
  const location = document.getElementById('cert-input-location')?.value.trim() || 'Ahmedabad, Gujarat / Remote';
  const manager = document.getElementById('cert-input-manager')?.value.trim() || 'Engineering Lead';
  const rating = document.getElementById('cert-input-rating')?.value.trim() || 'Outstanding Dedication & Technical Problem Solving';
  const signatoryName = document.getElementById('cert-input-signatory-name')?.value.trim() || 'Rajeev Ranjan';
  const signatoryTitle = document.getElementById('cert-input-signatory-title')?.value.trim() || 'Founder & Director, Synerbit OPC Private Limited';
  
  const contributionsRaw = document.getElementById('cert-input-contributions')?.value.trim() || '';
  const contributionList = contributionsRaw.split('\n')
    .map(l => l.replace(/^[\s•\-\*]+/, '').trim())
    .filter(Boolean);

  const responsibilitiesRaw = document.getElementById('cert-input-responsibilities')?.value.trim() || '';
  const responsibilityList = responsibilitiesRaw.split('\n')
    .map(l => l.replace(/^[\s•\-\*]+/, '').trim())
    .filter(Boolean);

  const experienceWorkRaw = document.getElementById('cert-input-experience-work')?.value.trim() || '';
  const experienceWorkList = experienceWorkRaw.split('\n')
    .map(l => l.replace(/^[\s•\-\*]+/, '').trim())
    .filter(Boolean);

  let refId = document.getElementById('cert-input-ref-id')?.value.trim() || 'FETCHING-REF-ID';

  const nomenclature = getDocNomenclature(currentCertTemplate, rawName, refId, 'standard');
  const nomEl = document.getElementById('cert-preview-nomenclature');
  if (nomEl) {
    nomEl.textContent = nomenclature;
  }

  const updatePageBadge = (totalPages) => {
    const badge = document.getElementById('cert-preview-badge');
    if (badge) {
      badge.textContent = totalPages === 1 ? '📄 1 Page A4' : `📄 ${totalPages} Pages A4`;
    }
  };

  const corporateHeaderHtml = `
    <div class="letter-header">
      <div style="display: flex; align-items: center; gap: 12px;">
        <img src="/synerbit-logo.png" alt="Synerbit OPC Private Limited" style="width: 44px; height: 44px; object-fit: contain; filter: drop-shadow(0 2px 5px rgba(0,0,0,0.08));" />
        <div>
          <div style="font-size: 1.15rem; font-weight: 900; letter-spacing: -0.01em; color: #0f172a; line-height: 1.15;">
            SYNERBIT OPC <span style="color: #0284c7;">PRIVATE LIMITED</span>
          </div>
          <div style="font-size: 0.63rem; color: #0284c7; font-weight: 700; letter-spacing: 0.04em;">
            Powering Businesses Through Technology &amp; Innovation.
          </div>
        </div>
      </div>
      <div style="text-align: right; font-size: 0.68rem; color: #475569; line-height: 1.38;">
        <div><strong>Synerbit OPC Private Limited</strong></div>
        <div style="font-size: 0.60rem; color: #64748b; font-family: monospace;">CIN: U62099GJ2026OPC184349</div>
        <div>A606 PNTC, Times of India Press Road, Manekbag</div>
        <div>Ahmedabad – 380015, Gujarat</div>
        <div>Web: <span style="color: #0284c7; font-weight: 600;">synerbit.in</span> | Email: contact@synerbit.in</div>
      </div>
    </div>
    <div style="height: 2px; background: linear-gradient(90deg, #0284c7 0%, #38bdf8 50%, #e2e8f0 100%); margin: 8px 0 12px 0; border-radius: 2px;"></div>
  `;

  const runningHeaderHtml = `
    <div class="letter-running-header" style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 8px; border-bottom: 1.5px solid #0284c7; margin-bottom: 14px;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <img src="/synerbit-logo.png" alt="Synerbit" style="width: 24px; height: 24px; object-fit: contain;" />
        <span style="font-weight: 800; font-size: 0.82rem; color: #0f172a; letter-spacing: -0.01em;">
          SYNERBIT OPC <span style="color: #0284c7;">PRIVATE LIMITED</span>
        </span>
      </div>
      <div style="font-size: 0.68rem; color: #64748b; font-family: monospace;">
        <span>Ref: <strong style="color: #0284c7;">${escapeHtml(refId)}</strong></span> • <span>${escapeHtml(formatCertDate(offerDate))}</span>
      </div>
    </div>
  `;

  const pageBreakIndicatorHtml = (nextPageNum) => `
    <div class="a4-page-break-indicator">
      <div class="a4-page-break-line"></div>
      <div class="a4-page-break-badge">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span>Page Break • Page ${nextPageNum} Begins Below</span>
      </div>
      <div class="a4-page-break-line"></div>
    </div>
  `;

  const pageFooterHtml = (pageNum, totalPages) => `
    <div class="a4-doc-footer">
      <div>Synerbit OPC Private Limited • CIN: U62099GJ2026OPC184349</div>
      <div style="font-weight: 600; color: #64748b; font-family: monospace;">${escapeHtml(nomenclature)}</div>
      <div style="font-weight: 700; color: #64748b;">Page ${pageNum} of ${totalPages}</div>
    </div>
  `;

  if (currentCertTemplate === 'intern_offer') {
    updatePageBadge(1);
    sheet.innerHTML = `
      <div class="a4-page cert-sheet">
        <div class="a4-page-content">
          ${corporateHeaderHtml}
          
          <div style="display: flex; justify-content: space-between; font-size: 0.78rem; color: #475569; margin-bottom: 11px;">
            <div><strong>Ref No:</strong> <span style="font-family: monospace; color: #0284c7; font-weight: 700;">${escapeHtml(refId)}</span></div>
            <div><strong>Date:</strong> ${escapeHtml(formatCertDate(offerDate))}</div>
          </div>

          <div style="margin-bottom: 11px; font-size: 0.81rem; color: #1e293b; line-height: 1.42;">
            <div><strong>To,</strong></div>
            <div style="font-size: 0.98rem; font-weight: 800; color: #0f172a; margin: 1px 0;">${name}</div>
            ${email ? `<div style="color: #64748b; font-size: 0.75rem;">Email: ${escapeHtml(email)}</div>` : ''}
            <div style="color: #64748b; font-size: 0.75rem;">Location: ${escapeHtml(location)}</div>
          </div>

          <div style="margin-bottom: 10px; padding: 6px 10px; background: #f0f9ff; border-left: 4px solid #0284c7; border-radius: 0 4px 4px 0; font-size: 0.82rem; font-weight: 800; color: #0369a1; letter-spacing: 0.02em;">
            SUBJECT: FORMAL OFFER OF INTERNSHIP ENGAGEMENT — ${escapeHtml(role.toUpperCase())}
          </div>

          <div style="font-size: 0.79rem; color: #334155; line-height: 1.48; margin-bottom: 10px;">
            <p style="margin: 0 0 5px 0;">Dear <strong>${name}</strong>,</p>
            <p style="margin: 0;">
              On behalf of <strong>Synerbit OPC Private Limited</strong>, we are delighted to extend this formal offer of internship for the position of <strong>${escapeHtml(role)}</strong> within our <strong>${escapeHtml(dept)}</strong> team. Following our assessment of your technical capabilities and problem-solving skills, we are excited to have you contribute to our Upcoming Projects.
            </p>
          </div>

          <table class="letter-terms-table" style="margin: 6px 0 10px 0;">
            <tbody>
              <tr>
                <td class="term-label" style="width: 25%; padding: 5px 8px;">Position / Role:</td>
                <td class="term-val" style="width: 25%; padding: 5px 8px;"><strong>${escapeHtml(role)}</strong></td>
                <td class="term-label" style="width: 25%; padding: 5px 8px;">Department:</td>
                <td class="term-val" style="width: 25%; padding: 5px 8px;">${escapeHtml(dept)}</td>
              </tr>
              <tr>
                <td class="term-label" style="padding: 5px 8px;">Commencement Date:</td>
                <td class="term-val" style="padding: 5px 8px;"><strong style="color: #0284c7;">${escapeHtml(formatCertDate(joiningDate))}</strong></td>
                <td class="term-label" style="padding: 5px 8px;">Tenure / Duration:</td>
                <td class="term-val" style="padding: 5px 8px;">${escapeHtml(duration)}</td>
              </tr>
              <tr>
                <td class="term-label" style="padding: 5px 8px;">Monthly Stipend:</td>
                <td class="term-val" style="padding: 5px 8px;"><strong style="color: #10b981;">${escapeHtml(stipend)}</strong></td>
                <td class="term-label" style="padding: 5px 8px;">Work Arrangement:</td>
                <td class="term-val" style="padding: 5px 8px;">${escapeHtml(location)}</td>
              </tr>
              <tr>
                <td class="term-label" style="padding: 5px 8px;">Reporting Lead:</td>
                <td class="term-val" colspan="3" style="padding: 5px 8px;">${escapeHtml(manager)}</td>
              </tr>
            </tbody>
          </table>

          <div style="font-size: 0.77rem; color: #334155; line-height: 1.45;">
            <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 5px; padding: 6px 10px; margin-bottom: 8px;">
              <strong style="color: #b45309;">⚠️ Acceptance Deadline:</strong>
              <span style="color: #78350f;"> Please sign and return a scanned copy of this letter on or before <strong>${escapeHtml(formatCertDate(deadline))} (5:00 PM IST)</strong>, failing which this offer automatically lapses.</span>
            </div>
            <p style="margin: 0 0 4px 0;"><strong>1. Intellectual Property &amp; Confidentiality:</strong> All software source code, system architectures, and designs authored during your engagement belong solely to Synerbit OPC Private Limited. You agree to safeguard proprietary systems and customer data.</p>
            <p style="margin: 0 0 4px 0;"><strong>2. Termination Notice:</strong> Either party may conclude this engagement with 7 calendar days of written notice.</p>
            <p style="margin: 0;">We warmly welcome you to the Synerbit team and look forward to building groundbreaking software products together.</p>
          </div>
        </div>

        <div class="a4-page-footer-zone">
          <div class="letter-signoff" style="margin-top: 10px; display: flex; justify-content: space-between; align-items: flex-end;">
            <div style="display: flex; align-items: flex-end; gap: 14px;">
              <div>
                <div style="font-size: 0.73rem; color: #64748b; margin-bottom: 12px;">For <strong>Synerbit OPC Private Limited</strong></div>
                <div style="font-weight: 800; color: #0f172a; font-size: 0.85rem;">${escapeHtml(signatoryName)}</div>
                <div style="font-size: 0.72rem; color: #64748b;">${escapeHtml(signatoryTitle)}</div>
                <div style="margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid #bae6fd; border-radius: 4px; padding: 2px 6px; font-size: 0.62rem; color: #0284c7; background: #f0f9ff; font-weight: 700;">
                  ✓ Officially Sealed
                </div>
              </div>
              <img src="/synerbit-stamp.png" alt="Company Stamp" style="width: 70px; height: 70px; object-fit: contain; opacity: 0.95; transform: rotate(-3deg); filter: drop-shadow(0 2px 4px rgba(0,0,0,0.06)); margin-bottom: 2px;" />
            </div>
            <div style="text-align: right;">
              <div style="font-size: 0.73rem; color: #64748b; margin-bottom: 14px;">Candidate Acceptance Acknowledgement</div>
              <div style="font-weight: 800; color: #0f172a; font-size: 0.85rem;">${name}</div>
              <div style="font-size: 0.72rem; color: #64748b;">Signature &amp; Date: ______________________</div>
            </div>
          </div>
          ${pageFooterHtml(1, 1)}
        </div>
      </div>
    `;
  } else if (currentCertTemplate === 'fulltime_offer') {
    const isMultiPage = responsibilityList.length > 0;
    const totalPages = isMultiPage ? 2 : 1;
    updatePageBadge(totalPages);

    if (isMultiPage) {
      sheet.innerHTML = `
        <div class="a4-page cert-sheet">
          <div class="a4-page-content">
            ${corporateHeaderHtml}
            
            <div style="display: flex; justify-content: space-between; font-size: 0.78rem; color: #475569; margin-bottom: 12px;">
              <div><strong>Ref No:</strong> <span style="font-family: monospace; color: #0284c7; font-weight: 700;">${escapeHtml(refId)}</span></div>
              <div><strong>Date:</strong> ${escapeHtml(formatCertDate(offerDate))}</div>
            </div>

            <div style="margin-bottom: 12px; font-size: 0.81rem; color: #1e293b; line-height: 1.45;">
              <div><strong>To,</strong></div>
              <div style="font-size: 1.0rem; font-weight: 800; color: #0f172a; margin: 2px 0;">${name}</div>
              ${email ? `<div style="color: #64748b; font-size: 0.76rem;">Email: ${escapeHtml(email)}</div>` : ''}
              <div style="color: #64748b; font-size: 0.76rem;">Location: ${escapeHtml(location)}</div>
            </div>

            <div style="margin-bottom: 11px; padding: 7px 11px; background: #f0fdf4; border-left: 4px solid #16a34a; border-radius: 0 4px 4px 0; font-size: 0.84rem; font-weight: 800; color: #15803d; letter-spacing: 0.02em;">
              SUBJECT: FORMAL APPOINTMENT LETTER &amp; EMPLOYMENT OFFER — ${escapeHtml(role.toUpperCase())}
            </div>

            <div style="font-size: 0.80rem; color: #334155; line-height: 1.5; margin-bottom: 11px;">
              <p style="margin: 0 0 6px 0;">Dear <strong>${name}</strong>,</p>
              <p style="margin: 0;">
                On behalf of <strong>Synerbit OPC Private Limited</strong>, we are thrilled to extend a formal offer of permanent employment as <strong>${escapeHtml(role)}</strong> within our <strong>${escapeHtml(dept)}</strong> organization. We were deeply impressed by your expertise, technical mastery, and potential to accelerate our product roadmap.
              </p>
            </div>

            <table class="letter-terms-table" style="margin-bottom: 12px;">
              <tbody>
                <tr>
                  <td class="term-label" style="width: 25%; padding: 5px 8px;">Designation:</td>
                  <td class="term-val" style="width: 25%; padding: 5px 8px;"><strong>${escapeHtml(role)}</strong></td>
                  <td class="term-label" style="width: 25%; padding: 5px 8px;">Department:</td>
                  <td class="term-val" style="width: 25%; padding: 5px 8px;">${escapeHtml(dept)}</td>
                </tr>
                <tr>
                  <td class="term-label" style="padding: 5px 8px;">Annual CTC / Compensation:</td>
                  <td class="term-val" style="padding: 5px 8px;"><strong style="color: #16a34a;">${escapeHtml(stipend)}</strong></td>
                  <td class="term-label" style="padding: 5px 8px;">Probationary Period:</td>
                  <td class="term-val" style="padding: 5px 8px;">3 Months</td>
                </tr>
                <tr>
                  <td class="term-label" style="padding: 5px 8px;">Date of Joining:</td>
                  <td class="term-val" style="padding: 5px 8px;"><strong style="color: #0284c7;">${escapeHtml(formatCertDate(joiningDate))}</strong></td>
                  <td class="term-label" style="padding: 5px 8px;">Work Arrangement:</td>
                  <td class="term-val" style="padding: 5px 8px;">${escapeHtml(location)}</td>
                </tr>
                <tr>
                  <td class="term-label" style="padding: 5px 8px;">Reporting Manager:</td>
                  <td class="term-val" colspan="3" style="padding: 5px 8px;">${escapeHtml(manager)}</td>
                </tr>
              </tbody>
            </table>

            <div style="margin-bottom: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-left: 3px solid #16a34a; border-radius: 4px; padding: 9px 13px; font-size: 0.77rem; color: #334155; line-height: 1.48;">
              <div style="font-weight: 800; color: #0f172a; margin-bottom: 5px; font-size: 0.79rem; display: flex; align-items: center; gap: 6px;">
                <span>📋</span> Key Roles &amp; Responsibilities:
              </div>
              <ul style="margin: 0; padding-left: 18px; list-style-type: disc;">
                ${responsibilityList.map(r => `<li style="margin-bottom: 4px;">${escapeHtml(r)}</li>`).join('')}
              </ul>
            </div>
          </div>

          <div class="a4-page-footer-zone">
            <div style="text-align: right; font-size: 0.72rem; color: #64748b; font-style: italic; margin-bottom: 6px;">
              [Continued on Page 2 for Terms of Employment, Signatures &amp; Acceptance →]
            </div>
            ${pageFooterHtml(1, 2)}
          </div>
        </div>

        ${pageBreakIndicatorHtml(2)}

        <div class="a4-page cert-sheet">
          <div class="a4-page-content">
            ${runningHeaderHtml}

            <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 5px; padding: 8px 12px; margin-bottom: 12px; font-size: 0.76rem; color: #78350f; line-height: 1.45;">
              <strong style="color: #b45309;">⚠️ Acceptance Deadline:</strong>
              <span> Please sign and return this appointment letter to <strong>contact@synerbit.in</strong> on or before <strong>${escapeHtml(formatCertDate(deadline))} (5:00 PM IST)</strong>. This offer is contingent upon successful credentials verification.</span>
            </div>

            <div style="font-size: 0.78rem; color: #334155; line-height: 1.52;">
              <div style="font-weight: 800; color: #0f172a; margin-bottom: 8px; font-size: 0.82rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">
                General Terms &amp; Conditions of Employment:
              </div>
              <p style="margin: 0 0 7px 0;"><strong>1. Duties &amp; Code of Conduct:</strong> You shall devotedly serve the company, observing highest workplace standards, ethical integrity, and information security policies.</p>
              <p style="margin: 0 0 7px 0;"><strong>2. Probation &amp; Notice Period:</strong> Upon completion of probation, either party may terminate employment with 30 calendar days of advance written notice or base salary in lieu thereof.</p>
              <p style="margin: 0 0 7px 0;"><strong>3. Confidentiality &amp; Intellectual Property:</strong> All software code, system architectures, client data, and inventions authored during employment belong exclusively to Synerbit OPC Private Limited.</p>
              <p style="margin: 0 0 10px 0;"><strong>4. Governing Law:</strong> This agreement is governed by the laws of India and subject to the exclusive jurisdiction of the courts in Ahmedabad, Gujarat.</p>
              <p style="margin: 0;">We congratulate you on this milestone and look forward to an enriching journey with Synerbit OPC Private Limited.</p>
            </div>
          </div>

          <div class="a4-page-footer-zone">
            <div class="letter-signoff" style="margin-top: 14px; display: flex; justify-content: space-between; align-items: flex-end;">
              <div style="display: flex; align-items: flex-end; gap: 14px;">
                <div>
                  <div style="font-size: 0.74rem; color: #64748b; margin-bottom: 14px;">For <strong>Synerbit OPC Private Limited</strong></div>
                  <div style="font-weight: 800; color: #0f172a; font-size: 0.86rem;">${escapeHtml(signatoryName)}</div>
                  <div style="font-size: 0.73rem; color: #64748b;">${escapeHtml(signatoryTitle)}</div>
                  <div style="margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid #bbf7d0; border-radius: 4px; padding: 2px 6px; font-size: 0.63rem; color: #16a34a; background: #f0fdf4; font-weight: 700;">
                    ✓ Officially Sealed
                  </div>
                </div>
                <img src="/synerbit-stamp.png" alt="Company Stamp" style="width: 72px; height: 72px; object-fit: contain; opacity: 0.95; transform: rotate(-3deg); filter: drop-shadow(0 2px 4px rgba(0,0,0,0.06)); margin-bottom: 2px;" />
              </div>
              <div style="text-align: right;">
                <div style="font-size: 0.74rem; color: #64748b; margin-bottom: 16px;">Candidate Acceptance Acknowledgement</div>
                <div style="font-weight: 800; color: #0f172a; font-size: 0.86rem;">${name}</div>
                <div style="font-size: 0.73rem; color: #64748b;">Signature &amp; Date: ______________________</div>
              </div>
            </div>
            ${pageFooterHtml(2, 2)}
          </div>
        </div>
      `;
    } else {
      sheet.innerHTML = `
        <div class="a4-page cert-sheet">
          <div class="a4-page-content">
            ${corporateHeaderHtml}
            
            <div style="display: flex; justify-content: space-between; font-size: 0.78rem; color: #475569; margin-bottom: 11px;">
              <div><strong>Ref No:</strong> <span style="font-family: monospace; color: #0284c7; font-weight: 700;">${escapeHtml(refId)}</span></div>
              <div><strong>Date:</strong> ${escapeHtml(formatCertDate(offerDate))}</div>
            </div>

            <div style="margin-bottom: 11px; font-size: 0.81rem; color: #1e293b; line-height: 1.42;">
              <div><strong>To,</strong></div>
              <div style="font-size: 0.98rem; font-weight: 800; color: #0f172a; margin: 1px 0;">${name}</div>
              ${email ? `<div style="color: #64748b; font-size: 0.75rem;">Email: ${escapeHtml(email)}</div>` : ''}
              <div style="color: #64748b; font-size: 0.75rem;">Location: ${escapeHtml(location)}</div>
            </div>

            <div style="margin-bottom: 10px; padding: 6px 10px; background: #f0fdf4; border-left: 4px solid #16a34a; border-radius: 0 4px 4px 0; font-size: 0.82rem; font-weight: 800; color: #15803d; letter-spacing: 0.02em;">
              SUBJECT: FORMAL APPOINTMENT LETTER &amp; EMPLOYMENT OFFER — ${escapeHtml(role.toUpperCase())}
            </div>

            <div style="font-size: 0.79rem; color: #334155; line-height: 1.48; margin-bottom: 10px;">
              <p style="margin: 0 0 5px 0;">Dear <strong>${name}</strong>,</p>
              <p style="margin: 0;">
                On behalf of <strong>Synerbit OPC Private Limited</strong>, we are thrilled to extend a formal offer of permanent employment as <strong>${escapeHtml(role)}</strong> within our <strong>${escapeHtml(dept)}</strong> organization. We were deeply impressed by your expertise, technical mastery, and potential to accelerate our product roadmap.
              </p>
            </div>

            <table class="letter-terms-table" style="margin: 6px 0 10px 0;">
              <tbody>
                <tr>
                  <td class="term-label" style="width: 25%; padding: 5px 8px;">Designation:</td>
                  <td class="term-val" style="width: 25%; padding: 5px 8px;"><strong>${escapeHtml(role)}</strong></td>
                  <td class="term-label" style="width: 25%; padding: 5px 8px;">Department:</td>
                  <td class="term-val" style="width: 25%; padding: 5px 8px;">${escapeHtml(dept)}</td>
                </tr>
                <tr>
                  <td class="term-label" style="padding: 5px 8px;">Annual CTC / Compensation:</td>
                  <td class="term-val" style="padding: 5px 8px;"><strong style="color: #16a34a;">${escapeHtml(stipend)}</strong></td>
                  <td class="term-label" style="padding: 5px 8px;">Probationary Period:</td>
                  <td class="term-val" style="padding: 5px 8px;">3 Months</td>
                </tr>
                <tr>
                  <td class="term-label" style="padding: 5px 8px;">Date of Joining:</td>
                  <td class="term-val" style="padding: 5px 8px;"><strong style="color: #0284c7;">${escapeHtml(formatCertDate(joiningDate))}</strong></td>
                  <td class="term-label" style="padding: 5px 8px;">Work Arrangement:</td>
                  <td class="term-val" style="padding: 5px 8px;">${escapeHtml(location)}</td>
                </tr>
                <tr>
                  <td class="term-label" style="padding: 5px 8px;">Reporting Manager:</td>
                  <td class="term-val" colspan="3" style="padding: 5px 8px;">${escapeHtml(manager)}</td>
                </tr>
              </tbody>
            </table>

            <div style="font-size: 0.77rem; color: #334155; line-height: 1.45;">
              <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 5px; padding: 6px 10px; margin-bottom: 8px;">
                <strong style="color: #b45309;">⚠️ Acceptance Deadline:</strong>
                <span style="color: #78350f;"> Please sign and return this appointment letter to <strong>contact@synerbit.in</strong> on or before <strong>${escapeHtml(formatCertDate(deadline))} (5:00 PM IST)</strong>. This offer is contingent upon successful credentials verification.</span>
              </div>
              <p style="margin: 0 0 4px 0;"><strong>1. Duties &amp; Code of Conduct:</strong> You shall devotedly serve the company, observing workplace standards and information security agreements.</p>
              <p style="margin: 0 0 4px 0;"><strong>2. Notice Period:</strong> Upon completion of probation, either party may terminate employment with 30 calendar days of advance written notice or base salary in lieu thereof.</p>
              <p style="margin: 0;">We congratulate you on this milestone and look forward to an enriching journey with Synerbit OPC Private Limited.</p>
            </div>
          </div>

          <div class="a4-page-footer-zone">
            <div class="letter-signoff" style="margin-top: 10px; display: flex; justify-content: space-between; align-items: flex-end;">
              <div style="display: flex; align-items: flex-end; gap: 14px;">
                <div>
                  <div style="font-size: 0.73rem; color: #64748b; margin-bottom: 12px;">For <strong>Synerbit OPC Private Limited</strong></div>
                  <div style="font-weight: 800; color: #0f172a; font-size: 0.85rem;">${escapeHtml(signatoryName)}</div>
                  <div style="font-size: 0.72rem; color: #64748b;">${escapeHtml(signatoryTitle)}</div>
                  <div style="margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid #bbf7d0; border-radius: 4px; padding: 2px 6px; font-size: 0.62rem; color: #16a34a; background: #f0fdf4; font-weight: 700;">
                    ✓ Officially Sealed
                  </div>
                </div>
                <img src="/synerbit-stamp.png" alt="Company Stamp" style="width: 70px; height: 70px; object-fit: contain; opacity: 0.95; transform: rotate(-3deg); filter: drop-shadow(0 2px 4px rgba(0,0,0,0.06)); margin-bottom: 2px;" />
              </div>
              <div style="text-align: right;">
                <div style="font-size: 0.73rem; color: #64748b; margin-bottom: 14px;">Candidate Acceptance Acknowledgement</div>
                <div style="font-weight: 800; color: #0f172a; font-size: 0.85rem;">${name}</div>
                <div style="font-size: 0.72rem; color: #64748b;">Signature &amp; Date: ______________________</div>
              </div>
            </div>
            ${pageFooterHtml(1, 1)}
          </div>
        </div>
      `;
    }
  } else if (currentCertTemplate === 'intern_completion') {
    updatePageBadge(1);
    sheet.innerHTML = `
      <div class="a4-page cert-sheet">
        <div class="cert-frame">
          <div class="cert-corner-decor cert-corner-tl"></div>
          <div class="cert-corner-decor cert-corner-tr"></div>
          <div class="cert-corner-decor cert-corner-bl"></div>
          <div class="cert-corner-decor cert-corner-br"></div>

          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; margin-bottom: 4px;">
            <img src="/synerbit-logo.png" alt="Synerbit OPC Private Limited" style="width: 52px; height: 52px; object-fit: contain; margin-bottom: 6px; filter: drop-shadow(0 3px 8px rgba(2, 132, 199, 0.2));" />
            <div style="font-size: 1.3rem; font-weight: 900; letter-spacing: 0.06em; color: #0f172a; text-transform: uppercase;">
              SYNERBIT OPC PRIVATE LIMITED
            </div>
            <div style="font-size: 0.68rem; letter-spacing: 0.04em; color: #0284c7; margin-top: 3px; font-weight: 700;">
              Powering Businesses Through Technology &amp; Innovation.
            </div>
          </div>

          <h1 style="font-size: 1.75rem; font-weight: 900; color: #0284c7; letter-spacing: 0.05em; margin: 8px 0 10px 0; text-transform: uppercase;">
            Certificate of Completion
          </h1>

          <p style="font-size: 0.84rem; color: #64748b; font-style: italic; margin-bottom: 6px;">
            This is proudly presented to
          </p>

          <div style="font-size: 1.85rem; font-weight: 900; color: #0f172a; margin: 4px 0 12px 0; border-bottom: 2px solid #38bdf8; display: inline-block; padding-bottom: 3px;">
            ${name}
          </div>

          <div style="font-size: 0.84rem; color: #334155; max-width: 600px; margin: 0 auto 12px auto; line-height: 1.55;">
            in recognition of their successful completion of the formal <strong>${escapeHtml(duration)}</strong> internship as <strong>${escapeHtml(role)}</strong> within the <strong>${escapeHtml(dept)}</strong> division at Synerbit OPC Private Limited from <strong>${escapeHtml(formatCertDate(joiningDate))}</strong> to <strong>${escapeHtml(formatCertDate(endDate))}</strong>.
          </div>

          ${contributionList.length > 0 ? `
            <div style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 8px 18px; max-width: 580px; margin: 0 auto 10px auto; font-size: 0.77rem; color: #334155; line-height: 1.45; text-align: left;">
              <div style="font-weight: 800; color: #0284c7; margin-bottom: 4px; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; text-align: center;">
                Key Contributions &amp; Projects Delivered
              </div>
              <ul style="margin: 0; padding-left: 18px; list-style-type: disc;">
                ${contributionList.map(item => `<li style="margin-bottom: 3px;">${escapeHtml(item)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          <div style="font-size: 0.76rem; color: #475569; max-width: 580px; margin: 0 auto 12px auto; line-height: 1.5; text-align: center;">
            During their tenure, <em>${name}</em> exhibited <strong>${escapeHtml(rating)}</strong>, contributing meaningfully to key software releases while displaying high integrity and teamwork.
          </div>

          <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 16px; padding: 0 14px;">
            <div style="text-align: left; font-size: 0.70rem; color: #64748b; line-height: 1.38; max-width: 290px;">
              <div><strong>Certificate ID:</strong> <span style="font-family: monospace; color: #0284c7; font-weight: 700;">${escapeHtml(refId)}</span></div>
              <div><strong>CIN:</strong> <span style="font-family: monospace; font-size: 0.65rem;">U62099GJ2026OPC184349</span></div>
              <div><strong>Date of Issue:</strong> ${escapeHtml(formatCertDate(offerDate))}</div>
              <div>A606 PNTC, Times of India Press Road, Manekbag, Ahmedabad – 380015, Gujarat</div>
              <div style="color: #0284c7; margin-top: 2px; font-weight: 600;">Verification: https://synerbit.in/verify</div>
            </div>
            
            <div style="text-align: center;">
              <img src="/synerbit-stamp.png" alt="Synerbit OPC Private Limited Official Stamp" style="width: 86px; height: 86px; object-fit: contain; margin: 0 auto; display: block; filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.08)); transform: rotate(-3deg);" />
            </div>

            <div style="text-align: right;">
              <div style="font-weight: 800; color: #0f172a; font-size: 0.86rem;">${escapeHtml(signatoryName)}</div>
              <div style="font-size: 0.72rem; color: #64748b;">${escapeHtml(signatoryTitle)}</div>
              <div style="font-size: 0.68rem; color: #94a3b8;">Synerbit OPC Private Limited</div>
            </div>
          </div>
        </div>
        ${pageFooterHtml(1, 1)}
      </div>
    `;
  } else if (currentCertTemplate === 'relieving_letter') {
    const isMultiPage = experienceWorkList.length > 0;
    const totalPages = isMultiPage ? 2 : 1;
    updatePageBadge(totalPages);

    if (isMultiPage) {
      sheet.innerHTML = `
        <div class="a4-page cert-sheet">
          <div class="a4-page-content">
            ${corporateHeaderHtml}
            
            <div style="display: flex; justify-content: space-between; font-size: 0.78rem; color: #475569; margin-bottom: 12px;">
              <div><strong>Ref No:</strong> <span style="font-family: monospace; color: #0284c7; font-weight: 700;">${escapeHtml(refId)}</span></div>
              <div><strong>Date:</strong> ${escapeHtml(formatCertDate(offerDate))}</div>
            </div>

            <div style="margin-bottom: 12px; font-size: 0.81rem; color: #1e293b; line-height: 1.45;">
              <div><strong>To,</strong></div>
              <div style="font-size: 1.0rem; font-weight: 800; color: #0f172a; margin: 2px 0;">${name}</div>
              ${email ? `<div style="color: #64748b; font-size: 0.76rem;">Email: ${escapeHtml(email)}</div>` : ''}
              <div style="color: #64748b; font-size: 0.76rem;">Location: ${escapeHtml(location)}</div>
            </div>

            <div style="margin-bottom: 12px; padding: 7px 11px; background: #f8fafc; border-left: 4px solid #0284c7; border-radius: 0 4px 4px 0; font-size: 0.84rem; font-weight: 800; color: #0f172a; letter-spacing: 0.02em;">
              SUBJECT: EXPERIENCE CUM RELIEVING LETTER — ${escapeHtml(role.toUpperCase())}
            </div>

            <div style="font-size: 0.81rem; color: #334155; line-height: 1.55; margin-bottom: 12px;">
              <p style="margin: 0 0 7px 0; font-weight: 700; color: #0f172a;">TO WHOMSOEVER IT MAY CONCERN</p>
              <p style="margin: 0 0 7px 0;">
                This is to certify that <strong>${name}</strong> was employed with <strong>Synerbit OPC Private Limited</strong> as <strong>${escapeHtml(role)}</strong> in our <strong>${escapeHtml(dept)}</strong> department from <strong>${escapeHtml(formatCertDate(joiningDate))}</strong> to <strong>${escapeHtml(formatCertDate(endDate))}</strong>.
              </p>
              <p style="margin: 0;">
                During their tenure with us, <strong>${name}</strong> handled their professional duties and technical responsibilities with commendable dedication, diligence, and expertise. Their work ethic and conduct with peers, clients, and management have been exemplary.
              </p>
            </div>

            <div style="margin-top: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-left: 3px solid #0284c7; border-radius: 4px; padding: 9px 13px; font-size: 0.77rem; color: #334155; line-height: 1.48;">
              <div style="font-weight: 800; color: #0f172a; margin-bottom: 5px; font-size: 0.79rem; display: flex; align-items: center; gap: 6px;">
                <span>💼</span> Key Scope of Work &amp; Projects Delivered:
              </div>
              <ul style="margin: 0; padding-left: 18px; list-style-type: disc;">
                ${experienceWorkList.map(item => `<li style="margin-bottom: 4px;">${escapeHtml(item)}</li>`).join('')}
              </ul>
            </div>
          </div>

          <div class="a4-page-footer-zone">
            <div style="text-align: right; font-size: 0.72rem; color: #64748b; font-style: italic; margin-bottom: 6px;">
              [Continued on Page 2 for Relieving Certification &amp; Signatures →]
            </div>
            ${pageFooterHtml(1, 2)}
          </div>
        </div>

        ${pageBreakIndicatorHtml(2)}

        <div class="a4-page cert-sheet">
          <div class="a4-page-content">
            ${runningHeaderHtml}

            <div style="font-size: 0.81rem; color: #334155; line-height: 1.58; margin-top: 6px;">
              <div style="font-weight: 800; color: #0f172a; margin-bottom: 8px; font-size: 0.82rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">
                Formal Relieving Confirmation &amp; Settlement:
              </div>
              <p style="margin: 0 0 8px 0;">
                This is to formally confirm that <strong>${name}</strong> is relieved of all organizational responsibilities and employment obligations with Synerbit OPC Private Limited effective close of business hours on <strong>${escapeHtml(formatCertDate(endDate))}</strong>.
              </p>
              <p style="margin: 0 0 8px 0;">
                There are no outstanding liabilities, financial dues, or company property pending on their part. All assigned intellectual assets, software repositories, and company credentials have been formally transitioned.
              </p>
              <p style="margin: 0;">
                We take this opportunity to thank <strong>${name}</strong> for their valuable contributions and exemplary work ethic during their tenure. We wish them grand success and personal fulfillment in all their future career pursuits.
              </p>
            </div>
          </div>

          <div class="a4-page-footer-zone">
            <div class="letter-signoff" style="margin-top: 18px; display: flex; justify-content: space-between; align-items: flex-end;">
              <div style="display: flex; align-items: flex-end; gap: 14px;">
                <div>
                  <div style="font-size: 0.74rem; color: #64748b; margin-bottom: 14px;">For <strong>Synerbit OPC Private Limited</strong></div>
                  <div style="font-weight: 800; color: #0f172a; font-size: 0.86rem;">${escapeHtml(signatoryName)}</div>
                  <div style="font-size: 0.73rem; color: #64748b;">${escapeHtml(signatoryTitle)}</div>
                  <div style="margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid #bae6fd; border-radius: 4px; padding: 2px 6px; font-size: 0.63rem; color: #0284c7; background: #f0f9ff; font-weight: 700;">
                    ✓ Officially Sealed
                  </div>
                </div>
                <img src="/synerbit-stamp.png" alt="Company Stamp" style="width: 72px; height: 72px; object-fit: contain; opacity: 0.95; transform: rotate(-3deg); filter: drop-shadow(0 2px 4px rgba(0,0,0,0.06)); margin-bottom: 2px;" />
              </div>
              <div style="text-align: right; font-size: 0.70rem; color: #64748b; line-height: 1.38;">
                <div><strong>Synerbit OPC Private Limited</strong></div>
                <div style="font-size: 0.60rem; color: #64748b; font-family: monospace;">CIN: U62099GJ2026OPC184349</div>
                <div>A606 PNTC, Times of India Press Road, Manekbag</div>
                <div>Ahmedabad – 380015, Gujarat</div>
                <div style="color: #0284c7; font-weight: 600;">contact@synerbit.in</div>
              </div>
            </div>
            ${pageFooterHtml(2, 2)}
          </div>
        </div>
      `;
    } else {
      sheet.innerHTML = `
        <div class="a4-page cert-sheet">
          <div class="a4-page-content">
            ${corporateHeaderHtml}
            
            <div style="display: flex; justify-content: space-between; font-size: 0.78rem; color: #475569; margin-bottom: 11px;">
              <div><strong>Ref No:</strong> <span style="font-family: monospace; color: #0284c7; font-weight: 700;">${escapeHtml(refId)}</span></div>
              <div><strong>Date:</strong> ${escapeHtml(formatCertDate(offerDate))}</div>
            </div>

            <div style="margin-bottom: 11px; font-size: 0.81rem; color: #1e293b; line-height: 1.42;">
              <div><strong>To,</strong></div>
              <div style="font-size: 0.98rem; font-weight: 800; color: #0f172a; margin: 1px 0;">${name}</div>
              ${email ? `<div style="color: #64748b; font-size: 0.75rem;">Email: ${escapeHtml(email)}</div>` : ''}
              <div style="color: #64748b; font-size: 0.75rem;">Location: ${escapeHtml(location)}</div>
            </div>

            <div style="margin-bottom: 10px; padding: 6px 10px; background: #f8fafc; border-left: 4px solid #0284c7; border-radius: 0 4px 4px 0; font-size: 0.82rem; font-weight: 800; color: #0f172a; letter-spacing: 0.02em;">
              SUBJECT: EXPERIENCE CUM RELIEVING LETTER — ${escapeHtml(role.toUpperCase())}
            </div>

            <div style="font-size: 0.79rem; color: #334155; line-height: 1.48; margin-bottom: 10px;">
              <p style="margin: 0 0 5px 0; font-weight: 700; color: #0f172a;">TO WHOMSOEVER IT MAY CONCERN</p>
              <p style="margin: 0 0 5px 0;">
                This is to certify that <strong>${name}</strong> was employed with <strong>Synerbit OPC Private Limited</strong> as <strong>${escapeHtml(role)}</strong> in our <strong>${escapeHtml(dept)}</strong> department from <strong>${escapeHtml(formatCertDate(joiningDate))}</strong> to <strong>${escapeHtml(formatCertDate(endDate))}</strong>.
              </p>
              <p style="margin: 0 0 5px 0;">
                During their tenure with us, <strong>${name}</strong> handled their professional duties and technical responsibilities with commendable dedication, diligence, and expertise. Their work ethic and conduct with peers, clients, and management have been exemplary.
              </p>
              <p style="margin: 0 0 5px 0;">
                <strong>${name}</strong> is relieved of all organizational responsibilities and employment obligations effective close of business hours on <strong>${escapeHtml(formatCertDate(endDate))}</strong>. There are no outstanding liabilities, financial dues, or company assets pending on their part.
              </p>
              <p style="margin: 0;">
                We take this opportunity to thank <strong>${name}</strong> for their valuable contributions to Synerbit OPC Private Limited and wish them continued success in all their future career pursuits.
              </p>
            </div>
          </div>

          <div class="a4-page-footer-zone">
            <div class="letter-signoff" style="margin-top: 10px; display: flex; justify-content: space-between; align-items: flex-end;">
              <div style="display: flex; align-items: flex-end; gap: 14px;">
                <div>
                  <div style="font-size: 0.73rem; color: #64748b; margin-bottom: 12px;">For <strong>Synerbit OPC Private Limited</strong></div>
                  <div style="font-weight: 800; color: #0f172a; font-size: 0.85rem;">${escapeHtml(signatoryName)}</div>
                  <div style="font-size: 0.72rem; color: #64748b;">${escapeHtml(signatoryTitle)}</div>
                  <div style="margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; border: 1px solid #bae6fd; border-radius: 4px; padding: 2px 6px; font-size: 0.62rem; color: #0284c7; background: #f0f9ff; font-weight: 700;">
                    ✓ Officially Sealed
                  </div>
                </div>
                <img src="/synerbit-stamp.png" alt="Company Stamp" style="width: 70px; height: 70px; object-fit: contain; opacity: 0.95; transform: rotate(-3deg); filter: drop-shadow(0 2px 4px rgba(0,0,0,0.06)); margin-bottom: 2px;" />
              </div>
              <div style="text-align: right; font-size: 0.69rem; color: #64748b; line-height: 1.35;">
                <div><strong>Synerbit OPC Private Limited</strong></div>
                <div style="font-size: 0.58rem; color: #64748b; font-family: monospace;">CIN: U62099GJ2026OPC184349</div>
                <div>A606 PNTC, Times of India Press Road, Manekbag</div>
                <div>Ahmedabad – 380015, Gujarat</div>
                <div style="color: #0284c7; font-weight: 600;">contact@synerbit.in</div>
              </div>
            </div>
            ${pageFooterHtml(1, 1)}
          </div>
        </div>
      `;
    }
  }
}

// Strictly fetch and load issued documents directly from Firebase Firestore
async function loadIssuedDocumentsFromFirebase() {
  const tbody = document.getElementById('cert-archive-table-body');
  const countBadge = document.getElementById('cert-archive-count');

  if (tbody && issuedDocumentsList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 24px 16px;">
      <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
        <span style="display: inline-block; width: 14px; height: 14px; border: 2px solid #0284c7; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite;"></span>
        <span>Loading issued documents directly from Firebase backend...</span>
      </div>
    </td></tr>`;
  }

  try {
    const db = await getFirestoreDb();
    const { collection, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const snap = await getDocs(collection(db, "issued_documents"));
    const docs = [];
    snap.forEach(d => {
      docs.push({ id: d.id, ...d.data() });
    });

    docs.sort((a, b) => new Date(b.createdAt || b.updatedAt || 0) - new Date(a.createdAt || a.updatedAt || 0));
    issuedDocumentsList = docs;
  } catch (err) {
    console.error("Failed to load issued documents from Firebase:", err);
  }

  renderCertArchiveTable();
}

// Render the Archive of Previously Issued Documents with full rich details
function renderCertArchiveTable() {
  const tbody = document.getElementById('cert-archive-table-body');
  const countBadge = document.getElementById('cert-archive-count');
  if (!tbody) return;

  if (countBadge) countBadge.textContent = `${issuedDocumentsList.length} Records`;

  if (issuedDocumentsList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 32px 16px;">
      <div style="font-size: 0.86rem; font-weight: 700; color: #475569; margin-bottom: 4px;">No documents saved to archive yet.</div>
      <div style="font-size: 0.73rem; color: #94a3b8;">Click "🖨️ Print / Save as PDF" or "💾 Save to Archive" above to automatically persist documents in the Firebase backend.</div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = issuedDocumentsList.map(doc => {
    const typeBadges = {
      intern_offer: '<span class="badge cyan">Intern Offer</span>',
      fulltime_offer: '<span class="badge emerald">Full-Time Offer</span>',
      intern_completion: '<span class="badge purple">Certificate</span>',
      relieving_letter: '<span class="badge amber">Relieving</span>'
    };
    const nomenclature = doc.nomenclature || getDocNomenclature(doc.template, doc.name, doc.refId, 'standard');
    return `
      <tr>
        <td>
          <div style="font-family: monospace; font-weight: 700; color: #0284c7; font-size: 0.82rem;">${escapeHtml(doc.refId || '—')}</div>
          <div style="font-size: 0.65rem; color: #94a3b8; margin-top: 2px;">
            ${doc.createdAt ? new Date(doc.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
          </div>
        </td>
        <td>
          <div style="font-weight: 700; color: #0f172a; font-size: 0.84rem;">${escapeHtml(doc.name || '—')}</div>
          <div style="font-size: 0.69rem; color: #0284c7; font-family: var(--font-mono); font-weight: 600; margin-top: 2px; word-break: break-all;">
            ${escapeHtml(nomenclature)}
          </div>
          ${doc.email ? `<div style="font-size: 0.68rem; color: #64748b; margin-top: 1px;">📧 ${escapeHtml(doc.email)}</div>` : ''}
        </td>
        <td>
          ${typeBadges[doc.template] || '<span class="badge gray">Document</span>'}
          <div style="font-size: 0.68rem; color: #64748b; margin-top: 4px;">${escapeHtml(doc.dept || 'Engineering')}</div>
        </td>
        <td>
          <div style="color: #334155; font-weight: 600; font-size: 0.78rem;">${escapeHtml(doc.role || '—')}</div>
          ${doc.stipend ? `<div style="font-size: 0.70rem; color: #16a34a; font-weight: 600; margin-top: 2px;">💰 ${escapeHtml(doc.stipend)}</div>` : ''}
          ${doc.duration ? `<div style="font-size: 0.68rem; color: #64748b;">⏱️ ${escapeHtml(doc.duration)}</div>` : ''}
        </td>
        <td style="color: #64748b; font-size: 0.75rem;">
          <div style="font-weight: 600; color: #334155;">${escapeHtml(formatCertDate(doc.offerDate))}</div>
          ${doc.location ? `<div style="font-size: 0.68rem; color: #94a3b8; margin-top: 2px;">📍 ${escapeHtml(doc.location)}</div>` : ''}
        </td>
        <td style="text-align: right;">
          <div style="display: inline-flex; gap: 6px; align-items: center;">
            <button class="btn-table-action" onclick="loadIssuedDocToEditor('${escapeHtml(doc.id)}')" title="Load into Editor & Preview" style="font-size: 0.72rem; padding: 4px 8px;">✏️ Edit</button>
            <button class="btn-table-action" onclick="quickPrintIssuedDoc('${escapeHtml(doc.id)}')" title="Print Document" style="font-size: 0.72rem; padding: 4px 8px;">🖨️</button>
            <button class="btn-table-action" onclick="deleteIssuedDoc('${escapeHtml(doc.id)}')" title="Delete from Firebase Archive" style="color: #ef4444; font-size: 0.72rem; padding: 4px 8px;">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Load a saved document back into the active editor form
window.loadIssuedDocToEditor = function(docId) {
  const item = issuedDocumentsList.find(d => d.id === docId);
  if (!item) return;

  activeEditingDocId = item.id;

  const btnPill = document.querySelector(`.cert-pill-btn[data-template="${item.template}"]`);
  if (btnPill) {
    document.querySelectorAll('.cert-pill-btn').forEach(b => b.classList.remove('active'));
    btnPill.classList.add('active');
  }

  if (document.getElementById('cert-input-name')) document.getElementById('cert-input-name').value = item.name || '';
  if (document.getElementById('cert-input-email')) document.getElementById('cert-input-email').value = item.email || '';
  if (document.getElementById('cert-input-role')) document.getElementById('cert-input-role').value = item.role || '';
  if (document.getElementById('cert-input-dept')) document.getElementById('cert-input-dept').value = item.dept || 'Engineering & Product';
  if (document.getElementById('cert-input-offer-date')) document.getElementById('cert-input-offer-date').value = item.offerDate || '';
  if (document.getElementById('cert-input-joining-date')) document.getElementById('cert-input-joining-date').value = item.joiningDate || '';
  if (document.getElementById('cert-input-deadline')) document.getElementById('cert-input-deadline').value = item.deadline || '';
  if (document.getElementById('cert-input-duration')) document.getElementById('cert-input-duration').value = item.duration || '3 Months';
  if (document.getElementById('cert-input-end-date')) document.getElementById('cert-input-end-date').value = item.endDate || '';
  if (document.getElementById('cert-input-stipend')) document.getElementById('cert-input-stipend').value = item.stipend || '';
  if (document.getElementById('cert-input-location')) document.getElementById('cert-input-location').value = item.location || 'Ahmedabad, Gujarat / Remote';
  if (document.getElementById('cert-input-manager')) document.getElementById('cert-input-manager').value = item.manager || 'Engineering Lead';
  if (document.getElementById('cert-input-rating')) document.getElementById('cert-input-rating').value = item.rating || '';
  if (document.getElementById('cert-input-contributions')) document.getElementById('cert-input-contributions').value = item.contributions || '';
  if (document.getElementById('cert-input-responsibilities')) document.getElementById('cert-input-responsibilities').value = item.responsibilities || '';
  if (document.getElementById('cert-input-experience-work')) document.getElementById('cert-input-experience-work').value = item.experienceWork || '';
  if (document.getElementById('cert-input-signatory-name')) document.getElementById('cert-input-signatory-name').value = item.signatoryName || 'Rajeev Ranjan';
  if (document.getElementById('cert-input-signatory-title')) document.getElementById('cert-input-signatory-title').value = item.signatoryTitle || 'Founder & Director, Synerbit OPC Private Limited';
  if (document.getElementById('cert-input-ref-id')) {
    const refEl = document.getElementById('cert-input-ref-id');
    refEl.value = item.refId || '';
    refEl.dataset.autoGenerated = 'false';
  }

  updateCertTemplateFields(item.template);
  updateRefIdValidationBadge(item.refId);
  showToast(`Loaded document ${item.refId} into editor`, 'success');
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

// Quick Print an issued document directly from the archive
window.quickPrintIssuedDoc = function(docId) {
  loadIssuedDocToEditor(docId);
  setTimeout(() => {
    handleCertPrint();
  }, 120);
};

// Permanently delete a document directly from the Firebase archive
window.deleteIssuedDoc = async function(docId) {
  if (!confirm('Are you sure you want to permanently delete this document from Firebase backend?')) return;
  try {
    const db = await getFirestoreDb();
    const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    await deleteDoc(doc(db, "issued_documents", docId));
    showToast('Document deleted from Firebase archive', 'info');
    await loadIssuedDocumentsFromFirebase();
  } catch (err) {
    console.error("Failed to delete document from Firebase:", err);
    showToast(`Error deleting document: ${err.message}`, 'error');
  }
};

// Permanently delete ALL issued documents directly from the Firebase backend
window.deleteAllIssuedDocsFromFirebase = async function() {
  if (!issuedDocumentsList || issuedDocumentsList.length === 0) {
    showToast('No documents to delete in Firebase archive.', 'info');
    return;
  }

  const count = issuedDocumentsList.length;
  const confirmMsg = `⚠️ Are you sure you want to permanently delete ALL ${count} issued document(s) from the Firebase backend?\n\nThis will completely purge all saved certificates and offer letters from the database. This action CANNOT be undone.`;
  if (!confirm(confirmMsg)) return;

  const btnDeleteAll = document.getElementById('btn-cert-delete-all');
  const originalText = btnDeleteAll ? btnDeleteAll.innerHTML : '';
  if (btnDeleteAll) {
    btnDeleteAll.disabled = true;
    btnDeleteAll.innerHTML = `<svg style="animation: adminSpin 0.7s linear infinite; display: inline-block; vertical-align: middle; margin-right: 4px;" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Deleting All from Firebase...`;
  }

  try {
    const db = await getFirestoreDb();
    const { doc, writeBatch } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    
    // Batch delete in chunks of 400 (Firestore max limit is 500 ops per batch)
    const chunkSize = 400;
    for (let i = 0; i < issuedDocumentsList.length; i += chunkSize) {
      const chunk = issuedDocumentsList.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      chunk.forEach(item => {
        batch.delete(doc(db, "issued_documents", item.id));
      });
      await batch.commit();
    }

    issuedDocumentsList = [];
    activeEditingDocId = null;
    showToast(`Successfully deleted all ${count} documents from Firebase backend!`, 'success');
    renderCertArchiveTable();
  } catch (err) {
    console.error("Failed to delete all documents from Firebase:", err);
    showToast(`Error deleting documents from Firebase: ${err.message}`, 'error');
    await loadIssuedDocumentsFromFirebase();
  } finally {
    if (btnDeleteAll) {
      btnDeleteAll.disabled = false;
      btnDeleteAll.innerHTML = originalText;
    }
  }
};

// Save active document directly to Firebase backend
async function handleCertSave(silent = false) {
  const btnSave = document.getElementById('btn-cert-save');
  if (btnSave && !silent) {
    btnSave.disabled = true;
    btnSave.textContent = 'Saving to Firebase...';
  }

  try {
    const nameInput = document.getElementById('cert-input-name');
    const name = nameInput?.value.trim();
    if (!name) {
      showToast('Please enter the Recipient Full Name before saving.', 'error');
      nameInput?.focus();
      return false;
    }

    const refIdInput = document.getElementById('cert-input-ref-id');
    let refId = refIdInput?.value.trim();
    if (!refId) {
      refId = await generateUniqueDocRefId(currentCertTemplate);
      if (refIdInput) refIdInput.value = refId;
    }

    // Pre-flight check: Verify uniqueness in Firebase backend before committing
    const isDuplicate = await checkDocRefIdExistsInFirebase(refId, activeEditingDocId);
    if (isDuplicate) {
      showToast(`Reference ID "${refId}" already exists in Firebase! Generating a new unique ID...`, 'error');
      refId = await generateUniqueDocRefId(currentCertTemplate);
      if (refIdInput) {
        refIdInput.value = refId;
        updateRefIdValidationBadge(refId);
      }
      renderCertPreview();
    }

    const email = document.getElementById('cert-input-email')?.value.trim() || '';
    const role = document.getElementById('cert-input-role')?.value.trim() || 'Software Engineer Intern';
    const dept = document.getElementById('cert-input-dept')?.value.trim() || 'Engineering & Product';
    const offerDate = document.getElementById('cert-input-offer-date')?.value || '';
    const joiningDate = document.getElementById('cert-input-joining-date')?.value || '';
    const deadline = document.getElementById('cert-input-deadline')?.value || '';
    const duration = document.getElementById('cert-input-duration')?.value.trim() || '3 Months';
    const endDate = document.getElementById('cert-input-end-date')?.value || '';
    const stipend = document.getElementById('cert-input-stipend')?.value.trim() || '';
    const location = document.getElementById('cert-input-location')?.value.trim() || '';
    const manager = document.getElementById('cert-input-manager')?.value.trim() || '';
    const rating = document.getElementById('cert-input-rating')?.value.trim() || '';
    const contributions = document.getElementById('cert-input-contributions')?.value.trim() || '';
    const responsibilities = document.getElementById('cert-input-responsibilities')?.value.trim() || '';
    const experienceWork = document.getElementById('cert-input-experience-work')?.value.trim() || '';
    const signatoryName = document.getElementById('cert-input-signatory-name')?.value.trim() || 'Rajeev Ranjan';
    const signatoryTitle = document.getElementById('cert-input-signatory-title')?.value.trim() || 'Founder & Director, Synerbit OPC Private Limited';

    const docId = activeEditingDocId || `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const nomenclature = getDocNomenclature(currentCertTemplate, name, refId, 'standard');
    const fileName = `${getDocNomenclature(currentCertTemplate, name, refId, 'filename')}.pdf`;

    const docRecord = {
      id: docId,
      refId,
      template: currentCertTemplate,
      nomenclature,
      fileName,
      name,
      email,
      role,
      dept,
      offerDate,
      joiningDate,
      deadline,
      duration,
      endDate,
      stipend,
      location,
      manager,
      rating,
      contributions,
      responsibilities,
      experienceWork,
      signatoryName,
      signatoryTitle,
      updatedAt: new Date().toISOString()
    };
    if (!activeEditingDocId) {
      docRecord.createdAt = new Date().toISOString();
    }

    // Direct write to Firebase Firestore collection "issued_documents"
    const db = await getFirestoreDb();
    const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    await setDoc(doc(db, "issued_documents", docRecord.id), docRecord, { merge: true });

    showToast(`Document ${nomenclature} successfully saved to Firebase backend!`, 'success');
    activeEditingDocId = null;

    // Reload archive directly from Firebase
    await loadIssuedDocumentsFromFirebase();
    return true;
  } catch (err) {
    console.error("Failed to save document to Firebase:", err);
    showToast(`Failed to save document: ${err.message || 'Firebase error'}`, 'error');
    return false;
  } finally {
    if (btnSave && !silent) {
      btnSave.disabled = false;
      btnSave.textContent = '💾 Save to Archive';
    }
  }
}

// Copy Document Text to Clipboard
function handleCertCopy() {
  const sheet = document.getElementById('cert-preview-sheet');
  if (!sheet) return;
  const text = sheet.innerText;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Document text copied to clipboard!', 'success');
  }).catch(() => {
    showToast('Failed to copy text', 'error');
  });
}

// High-Performance Isolated Print / Save as PDF with Option 1: Auto-Save to Backend
async function handleCertPrint() {
  const sheet = document.getElementById('cert-preview-sheet');
  if (!sheet) {
    window.print();
    return;
  }

  const rawName = document.getElementById('cert-input-name')?.value.trim();
  if (!rawName) {
    showToast('Please enter the Recipient Full Name before issuing/printing.', 'error');
    document.getElementById('cert-input-name')?.focus();
    return;
  }

  const btnPrint = document.getElementById('btn-cert-print');
  const originalHtml = btnPrint ? btnPrint.innerHTML : '';
  if (btnPrint) {
    btnPrint.disabled = true;
    btnPrint.innerHTML = `<svg style="animation: adminSpin 0.7s linear infinite; display: inline-block; vertical-align: middle; margin-right: 6px;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Saving to Backend...`;
  }

  // Option 1: Auto-save document directly to Firebase backend on Print
  try {
    const saved = await handleCertSave(true);
    if (!saved) {
      if (btnPrint) {
        btnPrint.disabled = false;
        btnPrint.innerHTML = originalHtml;
      }
      return;
    }
  } catch (err) {
    console.warn("Auto-save to Firebase failed during print:", err);
  }

  if (btnPrint) {
    btnPrint.innerHTML = `<svg style="animation: adminSpin 0.7s linear infinite; display: inline-block; vertical-align: middle; margin-right: 6px;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Preparing Print...`;
  }

  const refId = document.getElementById('cert-input-ref-id')?.value.trim() || 'REF';
  const fileName = getDocNomenclature(currentCertTemplate, rawName, refId, 'filename');

  const prevDocTitle = document.title;
  document.title = fileName;

  // Create or reuse hidden iframe to isolate the print job from the heavy admin console DOM
  let printFrame = document.getElementById('cert-print-iframe');
  if (!printFrame) {
    printFrame = document.createElement('iframe');
    printFrame.id = 'cert-print-iframe';
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = 'none';
    printFrame.style.opacity = '0';
    printFrame.style.pointerEvents = 'none';
    document.body.appendChild(printFrame);
  }

  const frameDoc = printFrame.contentWindow.document;
  frameDoc.open();

  // Inherit all stylesheet tags and fonts from parent
  let headStyles = '';
  document.querySelectorAll('link[rel="stylesheet"], style').forEach(el => {
    headStyles += el.outerHTML + '\n';
  });

  // Prepare clean HTML without preview-only divider indicators
  const clone = sheet.cloneNode(true);
  clone.querySelectorAll('.a4-page-break-indicator').forEach(el => el.remove());
  const printContentHtml = clone.innerHTML;

  frameDoc.write(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>${escapeHtml(fileName)}</title>
        ${headStyles}
        <style>
          @page {
            size: A4 portrait;
            margin: 0;
          }
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          html, body {
            background: #ffffff !important;
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            height: auto !important;
            overflow: visible !important;
          }
          .cert-print-container {
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .a4-page-break-indicator {
            display: none !important;
          }
          .a4-page,
          .cert-sheet {
            display: flex !important;
            flex-direction: column !important;
            justify-content: space-between !important;
            width: 100% !important;
            max-width: 210mm !important;
            box-shadow: none !important;
            border: none !important;
            margin: 0 auto !important;
            padding: 7mm 12mm 5mm 12mm !important;
            background: #ffffff !important;
            height: 272mm !important;
            min-height: 272mm !important;
            max-height: 272mm !important;
            box-sizing: border-box !important;
            overflow: hidden !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            page-break-after: auto !important;
            break-after: auto !important;
          }
          .a4-page + .a4-page,
          .cert-sheet + .cert-sheet {
            page-break-before: always !important;
            break-before: page !important;
          }
          .a4-page-content {
            flex: 1 1 auto !important;
            display: flex !important;
            flex-direction: column !important;
          }
          .a4-page-footer-zone {
            flex-shrink: 0 !important;
            margin-top: auto !important;
          }
          .cert-frame {
            display: flex !important;
            flex-direction: column !important;
            justify-content: space-between !important;
            height: 258mm !important;
            min-height: 258mm !important;
            max-height: 258mm !important;
            box-sizing: border-box !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            border: 5px double #0284c7 !important;
            padding: 20px 24px !important;
          }
          .letter-header,
          .letter-running-header,
          .letter-terms-table,
          .letter-signoff {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        </style>
      </head>
      <body>
        <div class="cert-print-container">
          ${printContentHtml}
        </div>
      </body>
    </html>
  `);
  frameDoc.close();

  const resetBtn = () => {
    if (btnPrint) {
      btnPrint.disabled = false;
      btnPrint.innerHTML = originalHtml;
    }
  };

  const firePrint = () => {
    setTimeout(() => {
      resetBtn();
      try {
        printFrame.contentWindow.focus();
        printFrame.contentWindow.print();
      } catch (err) {
        console.warn('Iframe print failed, falling back to window.print():', err);
        window.print();
      } finally {
        setTimeout(() => {
          document.title = prevDocTitle;
        }, 1500);
      }
    }, 40);
  };

  // Wait for images inside iframe to be ready before opening the print preview dialog
  const images = frameDoc.images;
  if (!images || images.length === 0) {
    firePrint();
  } else {
    let pending = images.length;
    let done = false;
    const onImg = () => {
      if (done) return;
      pending--;
      if (pending <= 0) {
        done = true;
        firePrint();
      }
    };
    for (let i = 0; i < images.length; i++) {
      if (images[i].complete) {
        onImg();
      } else {
        images[i].onload = onImg;
        images[i].onerror = onImg;
      }
    }
    // Fallback timer if browser already has images in cache
    setTimeout(() => {
      if (!done) {
        done = true;
        firePrint();
      }
    }, 250);
  }
}

// Master Initializer for Certificates & Letters
function initCertificatesModule() {
  // Set default dates
  const today = new Date();
  const formatYMD = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const offerDateEl = document.getElementById('cert-input-offer-date');
  if (offerDateEl && !offerDateEl.value) {
    offerDateEl.value = formatYMD(today);
  }

  const joinDate = new Date(today);
  joinDate.setDate(joinDate.getDate() + 14);
  const joinDateEl = document.getElementById('cert-input-joining-date');
  if (joinDateEl && !joinDateEl.value) {
    joinDateEl.value = formatYMD(joinDate);
  }

  const deadlineDate = new Date(today);
  deadlineDate.setDate(deadlineDate.getDate() + 7);
  const deadlineEl = document.getElementById('cert-input-deadline');
  if (deadlineEl && !deadlineEl.value) {
    deadlineEl.value = formatYMD(deadlineDate);
  }

  const endDate = new Date(joinDate);
  endDate.setDate(endDate.getDate() + 90);
  const endDateEl = document.getElementById('cert-input-end-date');
  if (endDateEl && !endDateEl.value) {
    endDateEl.value = formatYMD(endDate);
  }

  // Bind Template Pills
  document.querySelectorAll('.cert-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cert-pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const template = btn.dataset.template;
      updateCertTemplateFields(template);
    });
  });

  // Bind Live Input Change Listeners
  const inputIds = [
    'cert-input-name', 'cert-input-email', 'cert-input-role', 'cert-input-dept',
    'cert-input-offer-date', 'cert-input-joining-date', 'cert-input-deadline',
    'cert-input-duration', 'cert-input-end-date', 'cert-input-stipend',
    'cert-input-location', 'cert-input-manager', 'cert-input-rating',
    'cert-input-contributions', 'cert-input-responsibilities', 'cert-input-experience-work',
    'cert-input-signatory-name', 'cert-input-signatory-title', 'cert-input-ref-id'
  ];

  inputIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        if (id === 'cert-input-ref-id') el.dataset.autoGenerated = 'false';
        renderCertPreview();
      });
      el.addEventListener('change', renderCertPreview);
    }
  });

  // Bind Quick Auto-Fill from Candidate Applications
  const autofillSelect = document.getElementById('cert-autofill-app');
  if (autofillSelect) {
    autofillSelect.addEventListener('change', () => {
      const appId = autofillSelect.value;
      if (!appId) return;
      const app = currentApplications.find(a => a.id === appId);
      if (app) {
        if (document.getElementById('cert-input-name')) {
          document.getElementById('cert-input-name').value = app.name || app.fullName || '';
        }
        if (document.getElementById('cert-input-email')) {
          document.getElementById('cert-input-email').value = app.email || '';
        }
        if (document.getElementById('cert-input-role')) {
          document.getElementById('cert-input-role').value = app.jobTitle || app.role || 'Software Engineer Intern';
        }
        renderCertPreview();
        showToast(`Auto-filled details for ${app.name || 'Candidate'}`, 'success');
      }
    });
  }

  // Bind Action Buttons
  const btnPrint = document.getElementById('btn-cert-print');
  if (btnPrint) {
    btnPrint.addEventListener('click', handleCertPrint);
  }

  const btnSave = document.getElementById('btn-cert-save');
  if (btnSave) {
    btnSave.addEventListener('click', handleCertSave);
  }

  const btnCopy = document.getElementById('btn-cert-copy');
  if (btnCopy) {
    btnCopy.addEventListener('click', handleCertCopy);
  }

  // Bind Delete All Archive Button
  const btnDeleteAll = document.getElementById('btn-cert-delete-all');
  if (btnDeleteAll) {
    btnDeleteAll.addEventListener('click', deleteAllIssuedDocsFromFirebase);
  }

  // Bind Ref ID Refresh Button
  const btnGenRef = document.getElementById('btn-cert-gen-ref');
  if (btnGenRef) {
    btnGenRef.addEventListener('click', async () => {
      activeEditingDocId = null;
      const refInput = document.getElementById('cert-input-ref-id');
      const badge = document.getElementById('cert-ref-status');
      if (badge) {
        badge.className = 'badge blue';
        badge.textContent = '⏳ Checking Firebase...';
      }
      const newRef = await generateUniqueDocRefId(currentCertTemplate);
      if (refInput) {
        refInput.value = newRef;
        refInput.dataset.autoGenerated = 'true';
      }
      if (badge) {
        badge.className = 'badge emerald';
        badge.textContent = '✓ Verified Unique in Firebase';
      }
      renderCertPreview();
      showToast(`Generated unique ID from Firebase: ${newRef}`, 'success');
    });
  }

  // Bind Ref ID manual typing validation
  const refInput = document.getElementById('cert-input-ref-id');
  if (refInput) {
    refInput.addEventListener('input', () => {
      updateRefIdValidationBadge(refInput.value);
    });
    refInput.addEventListener('blur', () => {
      updateRefIdValidationBadge(refInput.value);
    });
  }

  // Initial field configuration & fetch live records from Firebase backend
  updateCertTemplateFields('intern_offer');
  populateCertCandidateDropdown();
  loadIssuedDocumentsFromFirebase();
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCertificatesModule);
} else {
  initCertificatesModule();
}
