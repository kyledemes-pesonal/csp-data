/* CSP's own published OpenArticle open-access fees, harvested from
   https://cdnsciencepub.com/journal/<code>/publication-fees on 2026-08-10.
   "For manuscripts originally submitted after January 1, 2026". Charged in CAD
   (plus tax) to authors in Canada and the same figure in USD outside Canada.
   Hand-curated (the publisher site blocks scripted fetches) — update by visiting
   the fee pages. Keys are OpenAlex source ids of the journal groups. */
window.CSP_FEES = {
  retrieved: "2026-08-10",
  source: "https://cdnsciencepub.com/authors-and-reviewers/publication-fees",
  note: "CSP OpenArticle standard OA fee for manuscripts submitted after 2026-01-01 (CAD in Canada / USD outside)",
  fees: {
    "S173941543": 3650,  // APNM
    "S159551863": 3600,  // Biochemistry and Cell Biology
    "S118554560": 3500,  // Botany
    "S105963835": 3700,  // Canadian Geotechnical Journal
    "S54036783": 1350,   // CJ Animal Science (+$90/page charge)
    "S9189650": 3400,    // CJ Chemistry
    "S10380613": 3700,   // CJ Civil Engineering
    "S4305354": 3400,    // CJ Earth Sciences
    "S57183551": 3950,   // CJ Fisheries and Aquatic Sciences
    "S115310785": 3750,  // CJ Forest Research
    "S182870142": 3500,  // CJ Microbiology
    "S173335977": 3400,  // CJ Physics
    "S82722058": 3500,   // CJ Physiology and Pharmacology
    "S34720450": 1350,   // CJ Plant Science (+$90/page charge)
    "S204002359": 1350,  // CJ Soil Science (+$90/page charge)
    "S146329739": 3900,  // CJ Zoology
    "S79420083": 3750,   // Environmental Reviews
    "S170991295": 3400,  // Genome
    "S3690700": 1350     // Transactions of the CSME (+$35/page charge)
  },
  page_charges: { "S54036783": 90, "S34720450": 90, "S204002359": 90, "S3690700": 35 }
};
