/**
 * Synerbit - Google Analytics 4 (GA4) to Firestore Sync Utility
 * 
 * This script pulls website telemetry (active users, page views, sessions,
 * bounce rate, top traffic sources, top pages) for both 30-Day and 24-Hour
 * windows from GA4 Data API v1beta and writes the summary to Firebase
 * Firestore ('site_analytics/overview').
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// 1. Initialize Firebase Admin SDK
function initFirebase() {
  if (admin.apps.length > 0) return admin.app();

  // Support direct string credentials from environment (Vercel, GitHub Actions)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      return admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    } catch (e) {
      console.warn("Notice: Failed to parse FIREBASE_SERVICE_ACCOUNT env var:", e.message);
    }
  }

  // Support service-account.json file path
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, 'service-account.json');
  if (fs.existsSync(credPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } else if (process.env.FIREBASE_CONFIG) {
    return admin.initializeApp();
  } else {
    try {
      return admin.initializeApp({
        credential: admin.credential.applicationDefault()
      });
    } catch (e) {
      console.warn("Notice: No Google service account credentials found at " + credPath);
      return null;
    }
  }
}

// 2. Mock Data Generator (for fallback or testing)
function getMockAnalytics() {
  return {
    // 30-Day Overview
    activeUsers: 1420,
    pageViews: 4890,
    sessions: 2150,
    engagementRate: "68.4%",
    bounceRate: "31.6%",
    topSources: [
      { source: "google", sessions: 840 },
      { source: "(direct)", sessions: 520 },
      { source: "linkedin.com", sessions: 390 },
      { source: "twitter.com / x.com", sessions: 240 },
      { source: "github.com", sessions: 160 }
    ],
    topPages: [
      { path: "/", views: 2480 },
      { path: "/jobs.html", views: 1250 },
      { path: "/products.html", views: 680 },
      { path: "/submit-idea.html", views: 320 },
      { path: "/privacy.html", views: 160 }
    ],

    // 24-Hour Overview
    activeUsers24h: 84,
    pageViews24h: 240,
    sessions24h: 110,
    engagementRate24h: "71.2%",
    bounceRate24h: "28.8%",
    topSources24h: [
      { source: "(direct)", sessions: 58 },
      { source: "google", sessions: 28 },
      { source: "linkedin.com", sessions: 14 },
      { source: "ig", sessions: 10 }
    ],
    topPages24h: [
      { path: "/", views: 140 },
      { path: "/jobs.html", views: 72 },
      { path: "/products.html", views: 28 }
    ],

    last24Hours: {
      activeUsers: 84,
      pageViews: 240,
      sessions: 110,
      engagementRate: "71.2%",
      bounceRate: "28.8%",
      topSources: [
        { source: "(direct)", sessions: 58 },
        { source: "google", sessions: 28 },
        { source: "linkedin.com", sessions: 14 },
        { source: "ig", sessions: 10 }
      ],
      topPages: [
        { path: "/", views: 140 },
        { path: "/jobs.html", views: 72 },
        { path: "/products.html", views: 28 }
      ]
    },

    last30Days: {
      activeUsers: 1420,
      pageViews: 4890,
      sessions: 2150,
      engagementRate: "68.4%",
      bounceRate: "31.6%",
      topSources: [
        { source: "google", sessions: 840 },
        { source: "(direct)", sessions: 520 },
        { source: "linkedin.com", sessions: 390 },
        { source: "twitter.com / x.com", sessions: 240 },
        { source: "github.com", sessions: 160 }
      ],
      topPages: [
        { path: "/", views: 2480 },
        { path: "/jobs.html", views: 1250 },
        { path: "/products.html", views: 680 },
        { path: "/submit-idea.html", views: 320 },
        { path: "/privacy.html", views: 160 }
      ]
    },

    lastSyncedAt: new Date().toISOString(),
    propertyId: "MOCK_DEMO_DATA",
    measurementId: "G-BJGWMMQV91"
  };
}

// 3. Fetch Real Analytics from GA4 Data API
async function fetchGA4Analytics(propertyId) {
  const { BetaAnalyticsDataClient } = require('@google-analytics/data');

  let clientOptions = {};
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      clientOptions = { credentials: JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) };
    } catch (_) {}
  }
  if (!clientOptions.credentials) {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, 'service-account.json');
    if (fs.existsSync(credPath)) {
      clientOptions = { keyFilename: credPath };
    }
  }

  const analyticsDataClient = new BetaAnalyticsDataClient(clientOptions);

  console.log(`[GA4] Querying Google Analytics Property: properties/${propertyId}...`);

  // Query 1: 30-Day Metrics Overview
  const [overviewReport30d] = await analyticsDataClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    metrics: [
      { name: 'activeUsers' },
      { name: 'screenPageViews' },
      { name: 'sessions' },
      { name: 'bounceRate' }
    ],
  });

  // Query 2: Top Traffic Sources (Last 30 Days)
  const [sourcesReport30d] = await analyticsDataClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'sessionSource' }],
    metrics: [{ name: 'sessions' }],
    limit: 5,
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }]
  });

  // Query 3: Top Visited Pages (Last 30 Days)
  const [pagesReport30d] = await analyticsDataClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }],
    limit: 5,
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }]
  });

  // Query 4: 24-Hour Metrics Overview
  const [overviewReport24h] = await analyticsDataClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: '1daysAgo', endDate: 'today' }],
    metrics: [
      { name: 'activeUsers' },
      { name: 'screenPageViews' },
      { name: 'sessions' },
      { name: 'bounceRate' }
    ],
  });

  // Query 5: Top Traffic Sources (Last 24 Hours)
  const [sourcesReport24h] = await analyticsDataClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: '1daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'sessionSource' }],
    metrics: [{ name: 'sessions' }],
    limit: 5,
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }]
  });

  // Query 6: Top Visited Pages (Last 24 Hours)
  const [pagesReport24h] = await analyticsDataClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: '1daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }],
    limit: 5,
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }]
  });

  // 30-Day Data Parsing
  const row30d = overviewReport30d.rows?.[0]?.metricValues || [];
  const activeUsers = parseInt(row30d[0]?.value || 0, 10);
  const pageViews = parseInt(row30d[1]?.value || 0, 10);
  const sessions = parseInt(row30d[2]?.value || 0, 10);
  const rawBounce30d = parseFloat(row30d[3]?.value || 0);
  const bounceRate = `${(rawBounce30d * 100).toFixed(1)}%`;
  const engagementRate = `${Math.max(0, (100 - (rawBounce30d * 100))).toFixed(1)}%`;

  const topSources = (sourcesReport30d.rows || []).map(r => ({
    source: r.dimensionValues[0]?.value || 'direct',
    sessions: parseInt(r.metricValues[0]?.value || 0, 10)
  }));

  const topPages = (pagesReport30d.rows || []).map(r => ({
    path: r.dimensionValues[0]?.value || '/',
    views: parseInt(r.metricValues[0]?.value || 0, 10)
  }));

  // 24-Hour Data Parsing
  const row24h = overviewReport24h.rows?.[0]?.metricValues || [];
  const activeUsers24h = parseInt(row24h[0]?.value || 0, 10);
  const pageViews24h = parseInt(row24h[1]?.value || 0, 10);
  const sessions24h = parseInt(row24h[2]?.value || 0, 10);
  const rawBounce24h = parseFloat(row24h[3]?.value || 0);
  const bounceRate24h = `${(rawBounce24h * 100).toFixed(1)}%`;
  const engagementRate24h = `${Math.max(0, (100 - (rawBounce24h * 100))).toFixed(1)}%`;

  const topSources24h = (sourcesReport24h.rows || []).map(r => ({
    source: r.dimensionValues[0]?.value || 'direct',
    sessions: parseInt(r.metricValues[0]?.value || 0, 10)
  }));

  const topPages24h = (pagesReport24h.rows || []).map(r => ({
    path: r.dimensionValues[0]?.value || '/',
    views: parseInt(r.metricValues[0]?.value || 0, 10)
  }));

  return {
    // Top-level 30-Day metrics
    activeUsers,
    pageViews,
    sessions,
    bounceRate,
    engagementRate,
    topSources,
    topPages,

    // Top-level 24-Hour metrics
    activeUsers24h,
    pageViews24h,
    sessions24h,
    bounceRate24h,
    engagementRate24h,
    topSources24h,
    topPages24h,

    // Structured breakdown
    last24Hours: {
      activeUsers: activeUsers24h,
      pageViews: pageViews24h,
      sessions: sessions24h,
      bounceRate: bounceRate24h,
      engagementRate: engagementRate24h,
      topSources: topSources24h,
      topPages: topPages24h
    },
    last30Days: {
      activeUsers,
      pageViews,
      sessions,
      bounceRate,
      engagementRate,
      topSources,
      topPages
    },

    lastSyncedAt: new Date().toISOString(),
    propertyId,
    measurementId: "G-BJGWMMQV91"
  };
}

// 4. Main Sync Function
async function syncGA4(customOptions = {}) {
  const isMock = customOptions.mock || process.argv.includes('--mock');
  const isDryRun = customOptions.dryRun || process.argv.includes('--dry-run');

  console.log("=== Synerbit GA4 Analytics Sync ===");

  let data;
  if (isMock) {
    console.log("[Mode] Generating mock telemetry data (--mock enabled)...");
    data = getMockAnalytics();
  } else {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, 'service-account.json');
    const hasCreds = fs.existsSync(credPath) || process.env.FIREBASE_SERVICE_ACCOUNT;
    
    if (!hasCreds) {
      console.warn(`\nNotice: Google Cloud Service Account key not found, using fallback cache.`);
      return null;
    }

    const DEFAULT_PROPERTY_ID = "558623130";
    const explicitProp = process.argv.slice(2).find(arg => !arg.startsWith('--'));
    const propertyId = customOptions.propertyId || process.env.GA4_PROPERTY_ID || explicitProp || DEFAULT_PROPERTY_ID;
    data = await fetchGA4Analytics(propertyId);
  }

  console.log("\n📊 Telemetry Summary:");
  console.log(`- 24h Visitors:  ${data.activeUsers24h.toLocaleString()} (Page Views: ${data.pageViews24h}, Sessions: ${data.sessions24h})`);
  console.log(`- 30d Visitors:  ${data.activeUsers.toLocaleString()} (Page Views: ${data.pageViews.toLocaleString()}, Sessions: ${data.sessions.toLocaleString()})`);
  console.log(`- Eng. Rate:     ${data.engagementRate} (24h: ${data.engagementRate24h})`);
  console.log(`- 24h Sources:   ${data.topSources24h.map(s => `${s.source} (${s.sessions})`).join(', ') || 'None'}`);
  console.log(`- 30d Sources:   ${data.topSources.map(s => `${s.source} (${s.sessions})`).join(', ')}`);

  if (isDryRun) {
    console.log("\n[Dry Run] Skipping Firestore save.");
    return data;
  }

  const app = initFirebase();
  if (!app) {
    console.error("\n❌ Error: Could not initialize Firebase Admin SDK.");
    return data;
  }

  const db = admin.firestore();
  console.log("\n[Firestore] Writing to 'site_analytics/overview'...");
  await db.collection('site_analytics').doc('overview').set(data, { merge: true });

  console.log("✅ Successfully updated 'site_analytics/overview' in Firestore!");
  return data;
}

if (require.main === module) {
  syncGA4().catch(err => {
    console.error("\n❌ Sync failed with error:", err);
    process.exit(1);
  });
}

module.exports = { syncGA4, fetchGA4Analytics, getMockAnalytics };
