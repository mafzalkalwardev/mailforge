/**
 * Original templates from Auto Emailer (email_sender.py) — 10 subjects + 10 bodies.
 * Random subject + random body per send (same behavior as the Python sender).
 */

const FREIGHT_DISPATCH_NAME = 'Freight Dispatch — INDUS Transports';

const FREIGHT_SUBJECT_TEMPLATES = [
    "Available Loads – Let's Work Together",
    "Steady Freight – Let's Keep Your Trucks Moving",
    "Freight Opportunities in {State} – Let's Connect",
    "Let's Keep Your Fleet Busy – Freight Available Now",
    "Dispatch Support for Your Fleet – Let's Talk Loads",
    "Open Lanes in {State} – Let's Fill Your Schedule",
    "Freight Dispatch Opportunities – Let's Build Together",
    "Let's Maximize Your Miles – Freight Available in {State}",
    "Ready to Dispatch – Let's Get Your Trucks Moving",
    "Let's Partner Up – Freight Opportunities in {State}",
];

const FREIGHT_BODY_TEMPLATES = [
    `Hi {Name},

I hope this message finds you well. My name is {SENDER_NAME}, and I'm currently looking to partner with reliable carriers for consistent freight dispatch opportunities.

We have loads available in {State}, and I'd love to learn more about your equipment and availability. If you're looking for steady work and fair rates, I believe we can build a strong partnership.

Please let me know if you're interested, and feel free to share your MC number and preferred lanes.

Looking forward to working with you!

Best regards,
{SENDER_NAME}
{COMPANY_NAME}
(785 572-4805)
{SENDER_EMAIL}`,

    `Hi {Name},

I'm reaching out to connect with dependable carriers who are ready for consistent freight opportunities. We're currently dispatching loads in {State}, and I'd love to help keep your trucks running profitably.

If you're open to new lanes or want to maximize your current routes, send me your MC number and ZIP code — I'll match you with the best loads available.

Let's build something solid together.

Best regards,
{SENDER_NAME}
{COMPANY_NAME}

(785 572-4805)
{SENDER_EMAIL}`,

    `Hi {Name},

We're currently dispatching freight in {State}, and I'm looking to team up with reliable carriers who want consistent work and competitive rates.

Whether you run local or OTR, I can help fill your schedule with profitable loads. Just send over your MC number and preferred lanes, and I'll get started.

Excited to work with you!

Best,
{SENDER_NAME}
{COMPANY_NAME}

(785 572-4805)
{SENDER_EMAIL}`,

    `Hi {Name},

I'm {SENDER_NAME} with {COMPANY_NAME}, and I'm currently onboarding carriers for active freight lanes in {State}.

We offer consistent dispatch, fair rates, and backhaul options to keep your trucks moving. Send me your MC number and ZIP code, and I'll match you with loads that fit your operation.

Looking forward to building a strong partnership.

Best regards,
{SENDER_NAME}
{COMPANY_NAME}

(785 572-4805)
{SENDER_EMAIL}`,

    `Hi {Name},

Are you looking for reliable dispatch support and steady freight? I'm currently working with carriers in {State} and would love to connect.

We offer local and OTR loads tailored to your lanes. Just send me your MC number and ZIP code, and I'll get started right away.

Let's make your routes more profitable.

Best,
{SENDER_NAME}
{COMPANY_NAME}

(785 572-4805)
{SENDER_EMAIL}`,

    `Hi {Name},

We have open lanes and freight ready to move in {State}, and I'm looking for dependable carriers to dispatch.

If you're interested in consistent work and competitive rates, send me your MC number and preferred lanes. I'll match you with loads that fit your fleet.

Let's keep your trucks rolling.

Best regards,
{SENDER_NAME}
{COMPANY_NAME}

(785 572-4805)
{SENDER_EMAIL}`,

    `Hi {Name},

I'm currently expanding my carrier network and would love to work with you. We have freight available in {State} and offer reliable dispatch with fair compensation.

Send me your MC number and ZIP code, and I'll get to work finding the best loads for your lanes.

Looking forward to connecting!

Best,
{SENDER_NAME}
{COMPANY_NAME}

(785 572-4805)
{SENDER_EMAIL}`,

    `Hi {Name},

I'm reaching out to offer dispatch support for carriers operating in {State}. We have freight ready to move and can help you keep your trucks loaded.

Just send me your MC number and ZIP code, and I'll match you with profitable loads that fit your schedule.

Let's make every mile count.

Best regards,
{SENDER_NAME}
{COMPANY_NAME}

(785 572-4805)
{SENDER_EMAIL}`,

    `Hi {Name},

We're actively dispatching freight in {State}, and I'm looking to connect with carriers who want consistent work and reliable support.

If you're interested, send me your MC number and ZIP code, and I'll match you with loads that fit your fleet and schedule.

Let's move freight together.

Best,
{SENDER_NAME}
{COMPANY_NAME}

(785 572-4805)
{SENDER_EMAIL}`,

    `Hi {Name},

I'm {SENDER_NAME} with {COMPANY_NAME}, and I'm currently looking for carriers to dispatch in {State}. We offer steady loads, fair rates, and personalized support.

Send me your MC number and ZIP code, and I'll get started matching you with the best freight for your lanes.

Looking forward to working together.

Best regards,
{SENDER_NAME}
{COMPANY_NAME}

(785 572-4805)
{SENDER_EMAIL}`,
];

const FREIGHT_DISPATCH_TEMPLATE = {
    name: FREIGHT_DISPATCH_NAME,
    companyName: 'INDUS TRANSPORTS LLC',
    isDefault: true,
    subjectTemplates: FREIGHT_SUBJECT_TEMPLATES,
    bodyTemplates: FREIGHT_BODY_TEMPLATES,
};

module.exports = {
    FREIGHT_DISPATCH_NAME,
    FREIGHT_DISPATCH_TEMPLATE,
    FREIGHT_SUBJECT_TEMPLATES,
    FREIGHT_BODY_TEMPLATES,
};
