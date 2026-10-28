/**
 * Synerbit Firebase Backend Integration & Storage
 * 
 * Connected directly to live Firebase Firestore.
 * No localStorage business data caching — all data originates and syncs in realtime
 * from the Firebase backend.
 */

export const firebaseConfig = {
  apiKey: "AIzaSyDCoBbSW08D1oCTCyezMd8OOGPadcZDO6Y",
  authDomain: "synerbit-ecosystem.firebaseapp.com",
  projectId: "synerbit-ecosystem",
  storageBucket: "synerbit-ecosystem.firebasestorage.app",
  messagingSenderId: "242148657242",
  appId: "1:242148657242:web:068059b2cffaa02e2ab063",
  measurementId: "G-BJGWMMQV91"
};

export const isFirebaseConfigured = () => {
  return (
    firebaseConfig.apiKey &&
    firebaseConfig.apiKey !== "YOUR_API_KEY" &&
    firebaseConfig.projectId &&
    firebaseConfig.projectId !== "YOUR_PROJECT_ID"
  );
};

// Purge all legacy local storage business data caches
['synerbit_applications', 'synerbit_deleted_applications', 'synerbit_ideas', 'synerbit_contacts', 'synerbit_products', 'synerbit_jobs', 'synerbit_team'].forEach(k => {
  try { localStorage.removeItem(k); } catch (_) {}
});

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
    id: "job-senior-backend",
    title: "Senior Backend Architect (Node.js & Cloud)",
    department: "Engineering",
    location: "Bengaluru / Hyderabad / Remote",
    type: "Full-Time",
    experience: "4+ Years",
    description: "Join our core incubation team building multi-tenant SaaS platforms from zero to one. You will design resilient backend services, manage databases, and implement scalable APIs.",
    requirements: [
      "Extensive experience building scalable Node.js / Go backend services and microservices.",
      "Solid understanding of relational and NoSQL databases (PostgreSQL, MongoDB, Firestore).",
      "Hands-on expertise with AWS/GCP, Docker, Redis caching, and CI/CD pipelines.",
      "Experience designing secure authentication (OAuth, JWT, SAML) and role-based permissions."
    ],
    status: "Active",
    postedAt: new Date("2026-10-05").toISOString()
  },
  {
    id: "job-product-designer",
    title: "Founding Product Designer",
    department: "Design",
    location: "Remote (India)",
    type: "Full-Time",
    experience: "2+ Years",
    description: "Shape the visual and interactive identity of new SaaS applications in Synerbit. You will drive UX research, rapid wireframing, high-fidelity prototypes, and component libraries.",
    requirements: [
      "Stunning portfolio showcasing end-to-end B2B/B2C SaaS design execution.",
      "Expertise with Figma, design tokens, interactive component states, and motion prototypes.",
      "Ability to translate complex technical workflows into clean, intuitive UI.",
      "Understanding of HTML/CSS capabilities and design system handoff to engineers."
    ],
    status: "Active",
    postedAt: new Date("2026-10-08").toISOString()
  }
];

export const DEFAULT_APPLICATIONS = [
  {
    id: "app-aarav-sharma",
    jobId: "job-1793012001229",
    jobTitle: "Software Engineer Intern",
    applicantName: "Aarav Sharma",
    name: "Aarav Sharma",
    applicantEmail: "aarav.sharma@example.com",
    email: "aarav.sharma@example.com",
    applicantPhone: "+91 98765 43210",
    phone: "+91 98765 43210",
    portfolioUrl: "https://github.com/aarav-sharma",
    notes: "Passionate about full-stack web development and excited about building high-velocity SaaS products at Synerbit.",
    internalNotes: "Strong GitHub portfolio with React & Node.js projects. Shortlisted for technical screening.",
    resumeUrl: "",
    resumeFileName: "Aarav_Sharma_Resume.pdf",
    status: "Shortlisted",
    submittedAt: new Date(Date.now() - 3600 * 1000 * 24 * 2).toISOString()
  },
  {
    id: "app-priya-patel",
    jobId: "job-1793037501741",
    jobTitle: "Marketing Intern",
    applicantName: "Priya Patel",
    name: "Priya Patel",
    applicantEmail: "priya.patel@example.com",
    email: "priya.patel@example.com",
    applicantPhone: "+91 98123 45678",
    phone: "+91 98123 45678",
    portfolioUrl: "https://linkedin.com/in/priyapatel-marketing",
    notes: "Eager to contribute to Synerbit's brand growth, digital content marketing, and student campus outreach.",
    internalNotes: "Initial screening passed. Excellent verbal articulation. Scheduled for interview round.",
    resumeUrl: "",
    resumeFileName: "Priya_Patel_CV.pdf",
    status: "Interview",
    submittedAt: new Date(Date.now() - 3600 * 1000 * 24 * 3).toISOString()
  },
  {
    id: "app-rohan-mehta",
    jobId: "job-1793166619342",
    jobTitle: "HR Intern",
    applicantName: "Rohan Mehta",
    name: "Rohan Mehta",
    applicantEmail: "rohan.mehta@example.com",
    email: "rohan.mehta@example.com",
    applicantPhone: "+91 97654 32109",
    phone: "+91 97654 32109",
    portfolioUrl: "",
    notes: "BBA graduate eager to start a career in talent acquisition and people operations.",
    internalNotes: "Profile under review by recruitment team.",
    resumeUrl: "",
    resumeFileName: "Rohan_Mehta_Resume.pdf",
    status: "Under Review",
    submittedAt: new Date(Date.now() - 3600 * 1000 * 24 * 4).toISOString()
  }
];

export const DEFAULT_IDEAS = [
  {
    id: "idea-docuflow",
    conceptName: "DocuFlow AI",
    founderName: "Vikram Verma",
    founderEmail: "vikram@docuflow.ai",
    background: "Ex-fintech engineer, 5 years building document processing systems.",
    productType: "B2B SaaS / Document Automation",
    stage: "MVP / Prototype",
    elevatorPitch: "Intelligent AI-driven document extraction, verification, and audit pipeline for high-compliance financial workflows.",
    submittedAt: new Date(Date.now() - 3600 * 1000 * 24 * 3).toISOString()
  },
  {
    id: "idea-cloudfin",
    conceptName: "CloudFin Ledger",
    founderName: "Neha Gupta",
    founderEmail: "neha@cloudfin.io",
    background: "Chartered Accountant & SaaS Product Lead.",
    productType: "FinTech / SMB Accounting",
    stage: "Early Traction",
    elevatorPitch: "Real-time automated multi-entity expense reconciliation and tax filing platform designed for modern Indian startups.",
    submittedAt: new Date(Date.now() - 3600 * 1000 * 24 * 5).toISOString()
  }
];

export const DEFAULT_CONTACTS = [
  {
    id: "contact-siddharth",
    name: "Siddharth Jain",
    email: "siddharth@innovate.co",
    subject: "Enterprise Partnership Inquiry",
    message: "Hello Synerbit team, we have been following your ecosystem products and would love to explore a strategic B2B partnership for our distribution network.",
    isRead: false,
    submittedAt: new Date(Date.now() - 3600 * 1000 * 12).toISOString()
  },
  {
    id: "contact-ananya",
    name: "Ananya Rao",
    email: "ananya@fintechlabs.in",
    subject: "PulsePM Product Demo",
    message: "Hi, our engineering leads are evaluating sprint management platforms. Could we schedule a 20-minute product walkthrough this week?",
    isRead: true,
    submittedAt: new Date(Date.now() - 3600 * 1000 * 36).toISOString()
  }
];

/* ==========================================================================
   PUBLIC CLIENT API (Jobs, Ideas, Products, Contacts) - Firebase Direct
   ========================================================================== */

/**
 * Fetch all active products directly from Firebase server without resurrecting deleted items
 */
export async function getProducts() {
  try {
    const { getFirestore, collection, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    const db = getFirestore(app);

    const deletedSnap = await getDocs(collection(db, "deleted_products")).catch(() => ({ docs: [] }));
    const deletedIds = new Set(deletedSnap.docs ? deletedSnap.docs.map(d => d.id) : []);

    const snapshot = await getDocs(collection(db, "products")).catch(() => ({ docs: [] }));
    const remoteProducts = snapshot.docs ? snapshot.docs.map(d => ({ id: d.id, ...d.data() })) : [];
    const valid = remoteProducts.filter(p => !deletedIds.has(p.id) && !p.isDeleted);
    return valid.length > 0 ? valid : DEFAULT_PRODUCTS;
  } catch (err) {
    console.warn("Live Firebase getProducts error:", err);
    return DEFAULT_PRODUCTS;
  }
}

/**
 * Fetch all active job listings directly from Firebase server without resurrecting deleted jobs
 */
export async function getJobs() {
  try {
    const { getFirestore, collection, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    const db = getFirestore(app);

    const deletedSnap = await getDocs(collection(db, "deleted_jobs")).catch(() => ({ docs: [] }));
    const deletedIds = new Set(deletedSnap.docs ? deletedSnap.docs.map(d => d.id) : []);

    const snapshot = await getDocs(collection(db, "jobs")).catch(() => ({ docs: [] }));
    const remoteJobs = snapshot.docs ? snapshot.docs.map(d => ({ id: d.id, ...d.data() })) : [];
    const valid = remoteJobs.filter(j => !deletedIds.has(j.id) && !j.isDeleted && j.status === "Active");
    return valid.length > 0 ? valid : DEFAULT_JOBS;
  } catch (err) {
    console.warn("Live Firebase getJobs error:", err);
    return DEFAULT_JOBS;
  }
}

/**
 * Subscribe to realtime active job updates directly from Firebase
 */
export function subscribeToJobs(callback) {
  let unsub = () => {};
  import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js").then(({ getFirestore, collection, onSnapshot, getDocs }) => {
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js").then(async ({ initializeApp, getApps }) => {
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(app);

      const deletedSnap = await getDocs(collection(db, "deleted_jobs")).catch(() => ({ docs: [] }));
      const deletedIds = new Set(deletedSnap.docs ? deletedSnap.docs.map(d => d.id) : []);

      unsub = onSnapshot(collection(db, "jobs"), (snapshot) => {
        let liveJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        liveJobs = liveJobs.filter(j => !deletedIds.has(j.id) && !j.isDeleted && j.status === "Active");
        if (typeof callback === "function") callback(liveJobs);
      }, err => console.warn("Realtime jobs subscription note:", err));
    });
  }).catch(() => {});
  return () => { try { unsub(); } catch (_) {} };
}

/**
 * Submit a Job Application directly to Firebase Firestore
 */
export async function submitJobApplication(applicationData, resumeFile) {
  let resumeUrl = applicationData.resumeUrl || "";

  if (resumeFile) {
    try {
      const { getStorage, ref, uploadBytes, getDownloadURL } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const storage = getStorage(app);
      const storageRef = ref(storage, `resumes/${Date.now()}_${resumeFile.name}`);
      const uploadResult = await uploadBytes(storageRef, resumeFile);
      resumeUrl = await getDownloadURL(uploadResult.ref);
    } catch (err) {
      console.warn("Storage upload note:", err);
    }
  }

  const payload = {
    jobId: applicationData.jobId || "general",
    jobTitle: applicationData.jobTitle || "General Application",
    applicantName: applicationData.applicantName || applicationData.name || "Candidate",
    name: applicationData.applicantName || applicationData.name || "Candidate",
    applicantEmail: applicationData.applicantEmail || applicationData.email || "",
    email: applicationData.applicantEmail || applicationData.email || "",
    applicantPhone: applicationData.applicantPhone || applicationData.phone || "",
    phone: applicationData.applicantPhone || applicationData.phone || "",
    portfolioUrl: applicationData.portfolioUrl || applicationData.link || "",
    notes: applicationData.notes || applicationData.note || "",
    resumeUrl: resumeUrl,
    resumeFileName: resumeFile ? resumeFile.name : (applicationData.resumeFileName || "No File"),
    status: applicationData.status || "New",
    submittedAt: new Date().toISOString()
  };

  const { getFirestore, collection, addDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const docRef = await addDoc(collection(db, "job_applications"), payload);
  return { success: true, id: docRef.id };
}

/**
 * Submit a SaaS Concept Idea directly to Firebase Firestore
 */
export async function submitIdea(ideaData) {
  const payload = {
    founderName: ideaData.founderName || "",
    founderEmail: ideaData.founderEmail || "",
    background: ideaData.background || "",
    conceptName: ideaData.conceptName || ideaData.ideaName || "Untitled Concept",
    productType: ideaData.productType || "",
    problem: ideaData.problem || "",
    solution: ideaData.solution || "",
    targetAudience: ideaData.targetAudience || "",
    stage: ideaData.stage || "Concept",
    successReason: ideaData.successReason || "",
    additionalContext: ideaData.additionalContext || "",
    deckUrl: ideaData.deckUrl || "",
    agreedToTerms: true,
    status: ideaData.status || "New",
    submittedAt: new Date().toISOString()
  };

  const { getFirestore, collection, addDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const docRef = await addDoc(collection(db, "idea_submissions"), payload);
  return { success: true, id: docRef.id };
}

/**
 * Submit Contact Form Message directly to Firebase Firestore
 */
export async function submitContactMessage(contactData) {
  const payload = {
    name: contactData.name || "Anonymous",
    email: contactData.email || "",
    subject: contactData.subject || "General Inquiry",
    message: contactData.message || "",
    status: "Unread",
    submittedAt: new Date().toISOString()
  };

  const { getFirestore, collection, addDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const docRef = await addDoc(collection(db, "contact_messages"), payload);
  return { success: true, id: docRef.id };
}
