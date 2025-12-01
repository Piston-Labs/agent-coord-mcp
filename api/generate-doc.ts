import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Piston Labs Document Generation API
 * 
 * Generates sales materials, pitches, and documentation from templates + context
 * 
 * POST /api/generate-doc
 * {
 *   type: 'pitch' | 'proposal' | 'executive-summary' | 'technical-brief' | 'objection-responses',
 *   target: 'shop-owner' | 'investor' | 'partner' | 'developer',
 *   customization?: { shopName, ownerName, specificNeeds, ... }
 * }
 */

// Document templates
const TEMPLATES = {
  pitch: {
    'shop-owner': {
      title: 'Piston Labs - Connected Vehicle Platform for {shopName}',
      sections: [
        {
          heading: 'The Challenge You Face',
          content: `{ownerName}, you're losing 60% of customers after their first visit - not because of poor service, but because you have no way to stay connected between appointments.

Dealers dominate with connected car data. They know when a customer's oil change is due. They send automated reminders. They make scheduling easy. And customers go back to them - even though your prices are better.`
        },
        {
          heading: 'Our Solution',
          content: `Piston Labs gives you the same connected vehicle capabilities that dealers have:

1. **OBD-II Telemetry Device** - Plugs into customer vehicles, streams real-time data
2. **Smart Reminders** - "You've driven 4,800 miles since your last oil change" (not arbitrary 6-month reminders)
3. **One-Tap Scheduling** - Customer taps notification, appointment lands in your calendar

The VIN connects everything. When you service a vehicle and upload the repair order, our system automatically links the customer, their device, their vehicle, and your shop.`
        },
        {
          heading: 'For {shopName}',
          content: `**Free Tier (Start Today):**
- Dashboard to manage customer relationships
- PDF repair order upload (auto-parses VIN)
- Customer profiles with service history

**Paid Tier (When Ready):**
- Calendar scheduling integration
- Automated service reminders
- Contextual promotion engine

{specificNeeds}`
        },
        {
          heading: 'Next Steps',
          content: `1. Sign up for free dashboard (5 minutes)
2. Upload a few repair orders to see the system work
3. We'll help you promote devices to your best customers
4. Watch retention improve as customers stay connected

Ready to stop losing customers to dealers?`
        }
      ]
    },
    'investor': {
      title: 'Piston Labs - Investment Overview',
      sections: [
        {
          heading: 'The Opportunity',
          content: `**$130B automotive aftermarket industry**
**250,000+ independent repair shops in the U.S.**
**Zero connected vehicle solutions for independent shops**

Independent shops lose 60% of customers after their first visit. Dealers win with connected car technology. We're leveling the playing field.`
        },
        {
          heading: 'Our Solution',
          content: `Three components working together:

1. **OBD-II Telemetry Devices** - Real-time vehicle data
2. **AWS Cloud Infrastructure** - Scalable, proven, operational
3. **Shop Dashboard** - Free CRM driving device adoption

The VIN-based data model is simple but powerful - it connects consumers, vehicles, shops, and service history without complex integrations.`
        },
        {
          heading: 'Traction',
          content: `**Technical Infrastructure: Operational**
- 3 active devices transmitting real-time data
- AWS IoT Core, Lambda, multi-database architecture
- <100ms processing, 0% error rate
- Designed for 1,000+ devices

**This proves we can execute.**`
        },
        {
          heading: 'The Ask',
          content: `Seed round to fund:
- Product development (Phase 2 automation features)
- Beta shop onboarding (5-10 local shops)
- Consumer acquisition (device subsidies)
- Team expansion (2 engineers, 1 sales)

**18-month target:** 100 devices, 50 shops, product-market fit signals`
        }
      ]
    }
  },
  'objection-responses': {
    'shop-owner': {
      title: 'Common Questions & Answers',
      sections: [
        {
          heading: '"My customers won\'t use an app"',
          content: `**Reality:** They don't have to. The device works automatically. Customers just get a text/push notification when service is due. One tap to schedule. No app required for basic functionality.

**Evidence:** 78% of consumers prefer text-based appointment reminders over phone calls.`
        },
        {
          heading: '"This sounds expensive"',
          content: `**Reality:** The dashboard is completely free. Forever. You only pay for premium features like calendar scheduling when you're ready.

**ROI:** If just ONE customer comes back because of a smart reminder, the device pays for itself. Average repair order is $350+.`
        },
        {
          heading: '"I don\'t have time for this"',
          content: `**Reality:** This SAVES you time. No more phone tag for scheduling. No more manual reminder calls. The system automates customer retention.

**Setup:** 5 minutes to create account. Drag-and-drop PDF upload. We handle the rest.`
        },
        {
          heading: '"How is this different from ShopGenie/Tekmetric?"',
          content: `**Key difference:** We have the device. They don't.

ShopGenie and Tekmetric are great shop management tools. We integrate with them - we don't replace them. But they can't tell you when a customer has driven 5,000 miles. We can.`
        },
        {
          heading: '"What about data privacy?"',
          content: `**Our approach:**
- Customer owns their data
- Shop sees only vehicles they've serviced
- No selling data to third parties
- Full encryption (TLS + at-rest)
- Compliant with privacy regulations

Customers choose to share data with their preferred shop. That's it.`
        }
      ]
    }
  },
  'executive-summary': {
    'investor': {
      title: 'Piston Labs - Executive Summary',
      sections: [
        {
          heading: 'One-Line Pitch',
          content: `Piston Labs builds the connected vehicle ecosystem for independent automotive shops - giving them the same competitive advantage that dealers have.`
        },
        {
          heading: 'The Problem',
          content: `Independent shops lose 60% of customers after their first visit. Dealers win with connected car data and automated retention. $130B industry, zero solutions for independents.`
        },
        {
          heading: 'Our Solution',
          content: `OBD-II device + cloud platform + shop dashboard. VIN-based data model connects everything automatically. Free tier drives adoption, paid tier monetizes.`
        },
        {
          heading: 'Traction',
          content: `Infrastructure operational. 3 devices, <100ms Lambda, 0% errors. Ready for beta shops.`
        },
        {
          heading: 'Team',
          content: `Tyler Porras (CEO) - 80% retention at Era Auto. Ryan Morris (CTO) - Dashboard development. Plus sales, hardware, and content founding team.`
        },
        {
          heading: 'Ask',
          content: `Seed funding for Phase 2 features, beta shop onboarding, and team expansion.`
        }
      ]
    }
  }
};

function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value || `[${key}]`);
  }
  return result;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET: List available templates
  if (req.method === 'GET') {
    const available = Object.entries(TEMPLATES).map(([type, targets]) => ({
      type,
      targets: Object.keys(targets)
    }));
    return res.json({
      templates: available,
      usage: 'POST /api/generate-doc with { type, target, customization }'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, target, customization = {} } = req.body || {};

    if (!type || !target) {
      return res.status(400).json({ 
        error: 'type and target required',
        available: Object.entries(TEMPLATES).map(([t, targets]) => ({
          type: t,
          targets: Object.keys(targets)
        }))
      });
    }

    const templateType = TEMPLATES[type as keyof typeof TEMPLATES];
    if (!templateType) {
      return res.status(404).json({ error: `Template type '${type}' not found` });
    }

    const template = templateType[target as keyof typeof templateType];
    if (!template) {
      return res.status(404).json({ error: `Target '${target}' not found for type '${type}'` });
    }

    // Default customization values
    const vars: Record<string, string> = {
      shopName: customization.shopName || 'Your Shop',
      ownerName: customization.ownerName || 'Shop Owner',
      specificNeeds: customization.specificNeeds || '',
      ...customization
    };

    // Generate document
    const document = {
      title: fillTemplate(template.title, vars),
      generatedAt: new Date().toISOString(),
      type,
      target,
      sections: template.sections.map(section => ({
        heading: fillTemplate(section.heading, vars),
        content: fillTemplate(section.content, vars)
      }))
    };

    // Generate markdown version
    let markdown = `# ${document.title}\n\n`;
    markdown += `*Generated: ${new Date().toLocaleString()}*\n\n---\n\n`;
    for (const section of document.sections) {
      markdown += `## ${section.heading}\n\n${section.content}\n\n`;
    }

    return res.json({
      success: true,
      document,
      markdown,
      wordCount: markdown.split(/\s+/).length
    });

  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
}
