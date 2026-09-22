/* C3PA Explorer - Badges & Label Helpers */
"use strict";

import { esc } from "../core/utils.js";

export const LABEL_COLORS = {
  "Categories of Personal Information Collected": "#0d6efd",
  "Categories of Personal Information Shared / Disclosed": "#7b2ff7",
  "Categories of Personal Information Sold": "#b45309",
  "Methods to exercise rights": "#16a34a",
  "Updated Privacy Policy": "#f97316",
  "Others": "#64748b",
  "Description of Right to Delete": "#e11d48",
  "Description of Right to Opt-out of sale of PI": "#0891b2",
  "Description of Right to Non-discrimination on exercising rights": "#db2777",
  "Description of Right to Know PI Collected": "#4f46e5",
  "Description of Right to Correct Information": "#0d9488",
  "Description of Right to Limit use of PI": "#a21caf",
  "Description of Right to Know PI sold / shared": "#475569",
};

export function labelColor(label) {
  return LABEL_COLORS[label] || "#6c757d";
}

export const LABEL_DESCRIPTIONS = {
  "Categories of Personal Information Collected": "The categories of personal information the business collects, typically enumerated in the policy -- identifiers, contact details, device and network activity, and similar.",
  "Categories of Personal Information Shared / Disclosed": "That personal information is shared or disclosed with third parties or service providers, naming the categories shared and the recipients.",
  "Categories of Personal Information Sold": "That personal information is sold for monetary or other valuable consideration, with the categories sold and the opt-out notice.",
  "Methods to exercise rights": "How to exercise privacy rights in practice: submission channels (web forms, phone, email), identity-verification requirements, and response timelines.",
  "Others": "Catch-all for privacy language that does not map to a specific C3PA category -- general notices, scope statements, and miscellaneous disclosures.",
  "Updated Privacy Policy": "Policy-change notices: 'we may update this policy' language, effective or last-revised dates, and how users are notified of revisions.",
  "Description of Right to Delete": "The consumer's right to request deletion of their personal information and the process for making such a request.",
  "Description of Right to Opt-out of sale of PI": "The right to opt out of the sale of personal information, including how to exercise the opt-out (e.g. a 'Do Not Sell' link).",
  "Description of Right to Non-discrimination on exercising rights": "Assurances that the business will not deny goods or services, charge different prices, or vary quality for consumers who exercise their rights.",
  "Description of Right to Know PI Collected": "The right to request disclosure of the categories and specific pieces of personal information collected about them.",
  "Description of Right to Correct Information": "The right to correct inaccurate personal information the business holds about the consumer.",
  "Description of Right to Limit use of PI": "The right to limit the use and disclosure of sensitive personal information, e.g. for targeted advertising or profiling.",
  "Description of Right to Know PI sold / shared": "The right to know which categories of personal information are sold or shared and with which categories of third parties.",
};

export function labelDescription(label) {
  return LABEL_DESCRIPTIONS[label] || "";
}

export function badge(label) {
  return `<span class="badge" style="background:${labelColor(label)}">${esc(label)}</span>`;
}

export function kindBadge(u) {
  if (u.unit_kind === "sentence")
    return '<span class="badge text-bg-success">sentence</span>';
  return `<span class="badge text-bg-secondary">fragment${u.fragment_type ? " &middot; " + esc(u.fragment_type) : ""}</span>`;
}

export function catBadge(cat) {
  const cls = { single_label: "text-bg-primary", multi_label: "text-bg-warning",
                unlabeled: "text-bg-light text-dark border", "not-eligible": "text-bg-secondary" }[cat] || "text-bg-secondary";
  return `<span class="badge ${cls}">${esc(cat)}</span>`;
}
