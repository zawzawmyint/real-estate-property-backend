// Fictional editorial profiles. These records are independent of staff accounts.
export const agencyCatalog = {
  agency: {
    name: 'Avenor Properties',
    isDemo: true,
    phone: null,
    email: null,
    address: null,
    officeHours: [],
    timeZone: 'Asia/Dubai',
    mapUrl: null,
  },
  agents: [
    {
      slug: 'amira-hassan',
      name: 'Amira Hassan',
      title: 'Residential Property Advisor',
      specialties: ['Waterfront homes', 'Family residences'],
      portrait: {
        src: '/images/agents/amira-hassan.webp',
        width: 800,
        height: 1000,
      },
      isDemo: true,
      introduction:
        'A fictional advisor profile exploring thoughtful spaces for everyday living.',
      biography: [
        'Amira is a fictional member of the Avenor demo team. This sample profile illustrates an approach to finding a home around lifestyle, location and long-term needs.',
        'Her fictional focus includes waterfront apartments and family residences across Dubai. This biography does not represent verified professional experience.',
      ],
      languages: ['English', 'Arabic'],
      publicPhone: null,
      publicEmail: null,
      published: true,
    },
    {
      slug: 'daniel-brooks',
      name: 'Daniel Brooks',
      title: 'Sales Property Advisor',
      specialties: ['City apartments', 'Residential sales'],
      portrait: {
        src: '/images/agents/daniel-brooks.webp',
        width: 800,
        height: 1000,
      },
      isDemo: true,
      introduction:
        'A fictional sales advisor profile with an interest in city living and considered property choices.',
      biography: [
        'Daniel is a fictional member of the Avenor demo team. His sample profile presents a clear, personal approach to understanding a buyer’s preferences.',
        'City apartments and residential sales are his fictional specialties. No qualifications, transaction history or professional results are claimed.',
      ],
      languages: ['English'],
      publicPhone: null,
      publicEmail: null,
      published: true,
    },
    {
      slug: 'leila-mansour',
      name: 'Leila Mansour',
      title: 'Leasing Property Advisor',
      specialties: ['Residential leasing', 'Neighbourhood discovery'],
      portrait: {
        src: '/images/agents/leila-mansour.webp',
        width: 800,
        height: 1000,
      },
      isDemo: true,
      introduction:
        'A fictional leasing advisor profile centred on finding a neighbourhood that feels like home.',
      biography: [
        'Leila is a fictional member of the Avenor demo team. This sample profile shows how a leasing advisor might introduce a personal approach to a home search.',
        'Her fictional interests include residential leasing and neighbourhood discovery. The profile is demonstration content and does not represent a real advisor.',
      ],
      languages: ['English', 'Arabic', 'French'],
      publicPhone: null,
      publicEmail: null,
      published: true,
    },
  ],
};
