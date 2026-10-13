/**
 * Synerbit Firebase Backend Integration & Storage
 * 
 * Works with live Firebase project when credentials are provided in `firebaseConfig`.
 * Automatically provides a seamless, persistent local fallback (localStorage + Blob URLs)
 * for testing and preview before live credentials are bound.
 */

// Replace these values with your actual Firebase project settings from Firebase Console:
// (Project Settings > General > Your apps > Web app)
export const firebaseConfig = {
  apiKey: "AIzaSyDCoBbSW08D1oCTCyezMd8OOGPadcZDO6Y",
  authDomain: "synerbit-ecosystem.firebaseapp.com",
  projectId: "synerbit-ecosystem",
  storageBucket: "synerbit-ecosystem.firebasestorage.app",
  messagingSenderId: "242148657242",
  appId: "1:242148657242:web:068059b2cffaa02e2ab063",
  measurementId: "G-BJGWMMQV91"
};

// Check if live Firebase is configured
export const isFirebaseConfigured = () => {
  return (
    firebaseConfig.apiKey &&
    firebaseConfig.apiKey !== "YOUR_API_KEY" &&
    firebaseConfig.projectId &&
    firebaseConfig.projectId !== "YOUR_PROJECT_ID"
  );
};

// Seed default initial data for mock / bootstrap mode
export const DEFAULT_PRODUCTS = [
  {
    id: "prod-pulsepm",
    name: "PulsePM",
    tagline: "Agile Project & Sprint Management Reimagined",
    description: "The modern project intelligence platform designed for high-velocity software engineering and product teams.",
    category: "Productivity & Engineering",
    status: "Live",
    statusColor: "cyan",
    webStatus: "Live",
    url: "https://www.pulsepm.in",
    androidStatus: "Live",
    androidUrl: "https://play.google.com/store/apps/details?id=in.pulsepm.app",
    iosStatus: "Coming Soon",
    iosUrl: "",
    createdAt: new Date("2026-01-01").toISOString(),
    featured: true
  },
  {
    id: "prod-goalsync",
    name: "Habitpot",
    tagline: "Outcome-Driven OKR & Execution Operating System",
    description: "Align cross-functional priorities, bridge strategic intent to daily execution, and eliminate status meeting bloat.",
    category: "Strategic Management",
    status: "In Development",
    statusColor: "emerald",
    webStatus: "Beta",
    url: "#",
    androidStatus: "Coming Soon",
    androidUrl: "",
    iosStatus: "Coming Soon",
    iosUrl: "",
    createdAt: new Date("2026-02-15").toISOString(),
    featured: true
  },
  {
    id: "prod-busly",
    name: "Busly",
    tagline: "Smart Transit & Fleet Fleet Operations Network",
    description: "Next-gen intelligent transit scheduling, telematics, and passenger tracking infrastructure for corporate fleets and urban transit.",
    category: "Logistics & Mobility",
    status: "Private Alpha",
    statusColor: "amber",
    webStatus: "In Development",
    url: "#",
    androidStatus: "Coming Soon",
    androidUrl: "",
    iosStatus: "Coming Soon",
    iosUrl: "",
    createdAt: new Date("2026-03-10").toISOString(),
    featured: true
  }
];

export const DEFAULT_JOBS = [
  {
    id: "job-lead-frontend",
    title: "Lead Frontend Engineer",
    department: "Engineering",
    location: "Bengaluru, India / Remote",
    type: "Full-Time",
    experience: "3+ Years",
    description: "We are seeking a Lead Frontend Engineer to architect high-performance, polished web applications across the Synerbit ecosystem. You will lead UI engineering, design system scalability, and craft pixel-perfect interactive experiences.",
    requirements: [
      "Deep expertise in modern JavaScript / TypeScript, React / Vue / Vite, and CSS architecture.",
      "Track record of shipping responsive, high-performance web products.",
      "Obsession with motion design, typography, and micro-interactions.",
      "Experience interfacing with cloud backends and REST/GraphQL APIs."
    ],
    status: "Active",
    postedAt: new Date("2026-10-01").toISOString()
  },
  {
    id: "job-fullstack-dev",
    title: "Full-Stack SaaS Engineer",
    department: "Product Engineering",
    location: "Remote",
    type: "Full-Time",
    experience: "2-4 Years",
    description: "Join our core incubation team building multi-tenant SaaS platforms from zero to one. You will design resilient backend services, manage databases, and implement scalable APIs.",
    requirements: [
      "Strong proficiency in Node.js, Python, or Go alongside modern frontend frameworks.",
      "Solid understanding of relational and NoSQL databases (PostgreSQL, MongoDB, Firestore).",
      "Experience with authentication, cloud infrastructure (GCP/AWS), and containerization.",
      "Self-directed problem solver excited about incubation speed."
    ],
    status: "Active",
    postedAt: new Date("2026-10-05").toISOString()
  },
  {
    id: "job-product-designer",
    title: "Senior Product Designer (UI/UX)",
    department: "Design",
    location: "Remote",
    type: "Full-Time",
    experience: "3+ Years",
    description: "Shape the visual and interactive identity of new SaaS applications in Synerbit. You will drive UX research, rapid wireframing, high-fidelity prototypes, and component libraries.",
    requirements: [
      "Outstanding portfolio demonstrating world-class SaaS application design.",
      "Mastery of Figma, design tokens, responsive layouts, and modern design systems.",
      "Ability to translate complex user workflows into clean, intuitive interfaces.",
      "Strong collaboration skills partnering directly with founding engineers."
    ],
    status: "Active",
    postedAt: new Date("2026-10-08").toISOString()
  }
];

// Helper to access LocalStorage collections
const getLocal = (key, fallback) => {
  try {
    const data = localStorage.getItem(`synerbit_${key}`);
    return data ? JSON.parse(data) : fallback;
  } catch {
    return fallback;
  }
};

const setLocal = (key, data) => {
  try {
    localStorage.setItem(`synerbit_${key}`, JSON.stringify(data));
  } catch (err) {
    console.error(`Error saving ${key} to localStorage:`, err);
  }
};

// Initialize default local store if empty
if (!localStorage.getItem("synerbit_products")) {
  setLocal("products", DEFAULT_PRODUCTS);
}
if (!localStorage.getItem("synerbit_jobs")) {
  setLocal("jobs", DEFAULT_JOBS);
}
if (!localStorage.getItem("synerbit_applications")) {
  setLocal("applications", []);
}
if (!localStorage.getItem("synerbit_ideas")) {
  setLocal("ideas", []);
}
if (!localStorage.getItem("synerbit_contacts")) {
  setLocal("contacts", []);
}
if (!localStorage.getItem("synerbit_team")) {
  setLocal("team", [
    {
      id: "admin-super",
      email: "rajeev@synerbit.in",
      name: "Rajeev Ranjan Kumar",
      role: "Super Admin",
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
  ]);
}

/* ==========================================================================
   PUBLIC CLIENT API (Jobs, Ideas, Products, Contacts)
   ========================================================================== */

/**
 * Fetch all active products
 */
export async function getProducts() {
  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, collection, getDocs, doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(app);

      // Check deleted products collection to ensure deleted items are never revived
      const deletedSnap = await getDocs(collection(db, "deleted_products")).catch(() => ({ docs: [] }));
      const deletedIds = new Set(deletedSnap.docs ? deletedSnap.docs.map(d => d.id) : []);

      const snapshot = await getDocs(collection(db, "products"));
      let remoteProducts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      // Auto-seed missing default products into Firestore if not deleted
      let seededAny = false;
      for (const defProd of DEFAULT_PRODUCTS) {
        if (!deletedIds.has(defProd.id) && !remoteProducts.some(p => p.id === defProd.id)) {
          remoteProducts.push(defProd);
          try {
            await setDoc(doc(db, "products", defProd.id), defProd, { merge: true });
            seededAny = true;
          } catch (_) {}
        }
      }

      if (remoteProducts.length > 0) {
        setLocal("products", remoteProducts);
        return remoteProducts;
      }
    } catch (err) {
      console.warn("Live Firebase getProducts failed, using local fallback:", err);
    }
  }
  return getLocal("products", DEFAULT_PRODUCTS);
}

/**
 * Fetch all active job listings
 */
export async function getJobs() {
  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, collection, getDocs, doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(app);

      // Check deleted jobs collection
      const deletedSnap = await getDocs(collection(db, "deleted_jobs")).catch(() => ({ docs: [] }));
      const deletedIds = new Set(deletedSnap.docs ? deletedSnap.docs.map(d => d.id) : []);

      const snapshot = await getDocs(collection(db, "jobs"));
      let remoteJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      // Auto-seed missing default jobs into Firestore if not deleted
      for (const defJob of DEFAULT_JOBS) {
        if (!deletedIds.has(defJob.id) && !remoteJobs.some(j => j.id === defJob.id)) {
          remoteJobs.push(defJob);
          try {
            await setDoc(doc(db, "jobs", defJob.id), defJob, { merge: true });
          } catch (_) {}
        }
      }

      if (remoteJobs.length > 0) {
        setLocal("jobs", remoteJobs);
        return remoteJobs.filter(j => j.status === "Active");
      }
    } catch (err) {
      console.warn("Live Firebase getJobs failed, using local fallback:", err);
    }
  }
  const jobs = getLocal("jobs", DEFAULT_JOBS);
  return jobs.filter(j => j.status === "Active");
}

/**
 * Submit a Job Application
 */
export async function submitJobApplication(applicationData, resumeFile) {
  let resumeUrl = applicationData.resumeUrl || "";

  // If a file was uploaded and live Firebase Storage is active
  if (resumeFile && isFirebaseConfigured()) {
    try {
      const { getStorage, ref, uploadBytes, getDownloadURL } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const storage = getStorage(app);
      const storageRef = ref(storage, `resumes/${Date.now()}_${resumeFile.name}`);
      const uploadResult = await uploadBytes(storageRef, resumeFile);
      resumeUrl = await getDownloadURL(uploadResult.ref);
    } catch (err) {
      console.warn("Storage upload failed, keeping client link:", err);
      resumeUrl = URL.createObjectURL(resumeFile);
    }
  } else if (resumeFile) {
    resumeUrl = URL.createObjectURL(resumeFile);
  }

  const payload = {
    ...applicationData,
    jobId: applicationData.jobId || "general",
    jobTitle: applicationData.jobTitle || "General Application",
    applicantName: applicationData.applicantName || applicationData.name || "Candidate",
    applicantEmail: applicationData.applicantEmail || applicationData.email || "",
    applicantPhone: applicationData.applicantPhone || applicationData.phone || "",
    portfolioUrl: applicationData.portfolioUrl || applicationData.link || "",
    notes: applicationData.notes || applicationData.note || "",
    resumeUrl: resumeUrl,
    resumeFileName: resumeFile ? resumeFile.name : (applicationData.resumeFileName || "No File"),
    status: applicationData.status || "New",
    submittedAt: applicationData.submittedAt || new Date().toISOString()
  };

  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, collection, addDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(app);
      const docRef = await addDoc(collection(db, "job_applications"), payload);
      
      // Keep local store in sync immediately
      const list = getLocal("applications", []);
      const newEntry = { id: docRef.id, ...payload };
      list.unshift(newEntry);
      setLocal("applications", list);

      return { success: true, id: docRef.id };
    } catch (err) {
      console.warn("Live Firebase addDoc failed, writing locally:", err);
    }
  }

  // Local fallback
  const list = getLocal("applications", []);
  const newEntry = { id: `app-${Date.now()}`, ...payload };
  list.unshift(newEntry);
  setLocal("applications", list);
  return { success: true, id: newEntry.id };
}

/**
 * Submit a SaaS Concept Idea
 */
export async function submitIdea(ideaData) {
  const payload = {
    ...ideaData,
    status: ideaData.status || "New",
    submittedAt: ideaData.submittedAt || new Date().toISOString()
  };

  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, collection, addDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(app);
      const docRef = await addDoc(collection(db, "idea_submissions"), payload);

      const list = getLocal("ideas", []);
      const newEntry = { id: docRef.id, ...payload };
      list.unshift(newEntry);
      setLocal("ideas", list);

      return { success: true, id: docRef.id };
    } catch (err) {
      console.warn("Live Firebase submitIdea failed, saving locally:", err);
    }
  }

  // Local fallback
  const list = getLocal("ideas", []);
  const newEntry = { id: `idea-${Date.now()}`, ...payload };
  list.unshift(newEntry);
  setLocal("ideas", list);
  return { success: true, id: newEntry.id };
}

/**
 * Submit Contact Form Message
 */
export async function submitContactMessage(contactData) {
  const payload = {
    ...contactData,
    status: contactData.status || "Unread",
    submittedAt: contactData.submittedAt || new Date().toISOString()
  };

  if (isFirebaseConfigured()) {
    try {
      const { getFirestore, collection, addDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(app);
      const docRef = await addDoc(collection(db, "contact_messages"), payload);

      const list = getLocal("contacts", []);
      const newEntry = { id: docRef.id, ...payload };
      list.unshift(newEntry);
      setLocal("contacts", list);

      return { success: true, id: docRef.id };
    } catch (err) {
      console.warn("Live Firebase submitContactMessage failed, saving locally:", err);
    }
  }

  const list = getLocal("contacts", []);
  const newEntry = { id: `contact-${Date.now()}`, ...payload };
  list.unshift(newEntry);
  setLocal("contacts", list);
  return { success: true, id: newEntry.id };
}
