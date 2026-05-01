/**
 * Transformation tests — exercise per-source-table transforms against
 * synthetic DumpRows that mirror the real Sequel Ace dump shape.
 *
 * These tests verify the boundary contracts: filters drop the right rows,
 * computed columns construct the right values, lookups resolve correctly.
 * Calibration: every transformation called here must trace to a job per
 * the C.t3 plan §"Calibration check".
 */

import { describe, expect, it } from 'vitest';
import {
  transformActivity,
  transformArea,
  transformCabin,
  transformCabintype,
  transformChunk,
  transformContentblock,
  transformCountry,
  transformCustomerReview,
  transformCustomerReviewTrip,
  transformFaqItem,
  transformHotel,
  transformImage,
  transformLocation,
  transformNtag,
  transformPage,
  transformTour,
  transformTourItem,
  transformTrip,
  transformVessel,
} from '../transformations.js';
import type { Lookups } from '../lookups.js';

function emptyLookups(): Lookups {
  return {
    currencyById: new Map(),
    fileById: new Map(),
    pagetypeById: new Map(),
    ntagsByEntity: new Map(),
    imageTripFirst: new Map(),
    imagePageFirst: new Map(),
  };
}

describe('transformCountry', () => {
  it('maps title → name and iso_3 → iso_code', () => {
    const out = transformCountry({
      table: 'country',
      values: { id: 1, title: 'Chile', alias: 'chile', iso_3: 'CHL' },
    });
    expect(out).toEqual({ id: 1, name: 'Chile', alias: 'chile', iso_code: 'CHL' });
  });

  it('drops soft-deleted rows', () => {
    expect(
      transformCountry({
        table: 'country',
        values: { id: 1, title: 'Chile', deleted: 1 },
      }),
    ).toBeNull();
  });
});

describe('transformNtag', () => {
  it('keeps active interest tag', () => {
    const out = transformNtag({
      table: 'ntag',
      values: { id: 5, title: 'Wildlife', alias: 'wildlife', type: 'interest', is_active: 1 },
    });
    expect(out).toMatchObject({ id: 5, title: 'Wildlife', type: 'interest', is_active: true });
  });

  it('drops invalid type', () => {
    expect(
      transformNtag({
        table: 'ntag',
        values: { id: 1, title: 'X', alias: 'x', type: 'unknown', is_active: 1 },
      }),
    ).toBeNull();
  });

  it('drops inactive tag', () => {
    expect(
      transformNtag({
        table: 'ntag',
        values: { id: 1, title: 'X', alias: 'x', type: 'area', is_active: 0 },
      }),
    ).toBeNull();
  });
});

describe('transformImage', () => {
  it('joins via image_id → file.id, builds canonical_url', () => {
    const lookups = emptyLookups();
    lookups.fileById.set(99, { name: 'torres.jpg', extension: 'jpg', type: 'image/jpeg' });
    lookups.ntagsByEntity.set('image', new Map([[42, [1, 2, 3]]]));

    const out = transformImage(
      {
        table: 'image',
        values: {
          id: 42,
          image_id: 99,
          title: 'Torres del Paine',
          description: 'Granite spires.',
          width: '1920',
          height: '1080',
        },
      },
      lookups,
    );
    expect(out).toMatchObject({
      id: 42,
      canonical_url: 'https://swoop-patagonia.imgix.net/torres.jpg',
      description: 'Granite spires.',
      width: 1920,
      height: 1080,
      original_filename: 'torres.jpg',
    });
  });

  it('drops image with no file row', () => {
    const out = transformImage(
      {
        table: 'image',
        values: { id: 42, image_id: 99 },
      },
      emptyLookups(),
    );
    expect(out).toBeNull();
  });
});

describe('transformPage', () => {
  it('builds canonical_url with override_url priority', () => {
    const lookups = emptyLookups();
    lookups.pagetypeById.set(5, 'Region');
    const result = transformPage(
      {
        table: 'page',
        values: {
          id: 100,
          pagetype_id: 5,
          alias: 'patagonia',
          title: 'Patagonia',
          override_url: 'chile/torres-del-paine',
          intro_text: 'Welcome to Patagonia.',
          summary: 'Long summary.',
          image_id: 1,
          banner_id: 2,
          parent_id: null,
        },
      },
      lookups,
    );
    expect(result.row).toMatchObject({
      id: 100,
      pagetype_id: 5,
      pagetype_title: 'Region',
      title: 'Patagonia',
      alias: 'patagonia',
      override_url: 'chile/torres-del-paine',
      canonical_url: 'https://www.swoop-patagonia.com/chile/torres-del-paine',
      intro_text: 'Welcome to Patagonia.',
      summary: 'Long summary.',
      image_id: 1,
      bannerimage_id: 2,
    });
  });

  it('falls back to alias when override_url empty', () => {
    const result = transformPage(
      {
        table: 'page',
        values: { id: 1, alias: 'argentina', title: 'Argentina', override_url: '' },
      },
      emptyLookups(),
    );
    expect(result.row?.canonical_url).toBe('https://www.swoop-patagonia.com/argentina');
  });

  it('drops Profile pagetype (id 20)', () => {
    const result = transformPage(
      {
        table: 'page',
        values: { id: 1, pagetype_id: 20, alias: 'staff/al', title: 'Al' },
      },
      emptyLookups(),
    );
    expect(result.row).toBeNull();
    expect(result.reason).toBe('profile_pagetype');
  });

  it('drops obvious test pages by alias', () => {
    const result = transformPage(
      {
        table: 'page',
        values: { id: 1, alias: 'test/sandbox', title: 'sandbox' },
      },
      emptyLookups(),
    );
    expect(result.row).toBeNull();
    expect(result.reason).toBe('test_page');
  });

  it('does NOT drop page whose alias contains "test" mid-word', () => {
    const result = transformPage(
      {
        table: 'page',
        values: { id: 1, alias: 'attestation', title: 'Attestation' },
      },
      emptyLookups(),
    );
    expect(result.row).not.toBeNull();
  });
});

describe('transformTrip', () => {
  it('resolves currency, page canonical_url, image via image_trip first', () => {
    const lookups = emptyLookups();
    lookups.currencyById.set(1, 'GBP');
    lookups.imageTripFirst.set(369, 555);
    lookups.imagePageFirst.set(50, 999);
    lookups.ntagsByEntity.set('trip', new Map([[369, [1, 2]]]));

    const pageCanonicalById = new Map([[50, 'https://www.swoop-patagonia.com/w-trek']]);

    const result = transformTrip(
      {
        table: 'trip',
        values: {
          id: 369,
          title: 'W Trek',
          alias: 'w-trek-torres-del-paine',
          page_id: 50,
          currency_id: 1,
          base_price: '1500.00',
          duration: '8 days',
          includes: 'Guide',
          excludes: 'Flights',
        },
      },
      lookups,
      pageCanonicalById,
    );
    expect(result.row).toMatchObject({
      id: 369,
      slug: 'w-trek-torres-del-paine',
      title: 'W Trek',
      currency_code: 'GBP',
      from_price: 1500,
      duration_days: 8,
      includes: 'Guide',
      excludes: 'Flights',
      ntag_ids: [1, 2],
      image_id: 555, // image_trip first per HITL Q4
      canonical_url: 'https://www.swoop-patagonia.com/w-trek',
      page_id: 50,
    });
  });

  it('falls back to image_page when no image_trip', () => {
    const lookups = emptyLookups();
    lookups.imagePageFirst.set(50, 999);

    const result = transformTrip(
      {
        table: 'trip',
        values: { id: 100, title: 'X', page_id: 50 },
      },
      lookups,
      new Map(),
    );
    expect(result.row?.image_id).toBe(999);
  });

  it('leaves image_id null when neither path resolves', () => {
    const result = transformTrip(
      { table: 'trip', values: { id: 100, title: 'X', page_id: null } },
      emptyLookups(),
      new Map(),
    );
    expect(result.row?.image_id).toBe(null);
  });
});

describe('transformCustomerReview', () => {
  it('keeps published with content', () => {
    const out = transformCustomerReview({
      table: 'customerreview',
      values: {
        id: 1,
        content: 'Loved it.',
        name: 'Jane',
        date: '2024-01-15 12:00:00',
        is_published: 1,
        location: 'UK',
        title: null,
      },
    });
    expect(out).toMatchObject({ id: 1, content: 'Loved it.', name: 'Jane', is_published: true });
  });

  it('drops unpublished', () => {
    expect(
      transformCustomerReview({
        table: 'customerreview',
        values: { id: 1, content: 'X', is_published: 0 },
      }),
    ).toBeNull();
  });
});

describe('transformContentblock', () => {
  it('drops navigationcard subtype (UI plumbing)', () => {
    const out = transformContentblock(
      { table: 'contentblock', values: { id: 1, page_id: 1, text: 'X' } },
      emptyLookups(),
      'navigationcard',
    );
    expect(out).toBeNull();
  });

  it('keeps customerreview subtype with prose', () => {
    const out = transformContentblock(
      { table: 'contentblock', values: { id: 1, page_id: 1, text: 'X' } },
      emptyLookups(),
      'customerreview',
    );
    expect(out).toMatchObject({ id: 1, subtype: 'customerreview', text: 'X' });
  });
});

describe('transformChunk / transformFaqItem / transformActivity / transformArea / transformLocation', () => {
  it('chunk maps content → text', () => {
    const out = transformChunk({
      table: 'chunk',
      values: { id: 1, alias: 'storycard', title: 'A', content: 'B' },
    });
    expect(out).toMatchObject({ id: 1, text: 'B' });
  });

  it('faqitem requires faqset_id', () => {
    expect(
      transformFaqItem({
        table: 'faqitem',
        values: { id: 1, title: 'Q', content: 'A', faqset_id: null },
      }),
    ).toBeNull();
    expect(
      transformFaqItem({
        table: 'faqitem',
        values: { id: 1, title: 'Q', content: 'A', faqset_id: 1 },
      }),
    ).toMatchObject({ id: 1, title: 'Q', content: 'A' });
  });

  it('activity passes title through to name', () => {
    expect(
      transformActivity({
        table: 'activity',
        values: { id: 1, title: 'Trekking - Torres del Paine' },
      }),
    ).toMatchObject({ id: 1, name: 'Trekking - Torres del Paine' });
  });

  it('location parses lat/lng strings', () => {
    expect(
      transformLocation({
        table: 'location',
        values: { id: 1, title: 'Refugio', latitude: '-50.95', longitude: '-72.99' },
      }),
    ).toMatchObject({ id: 1, latitude: -50.95, longitude: -72.99 });
  });

  it('area passes through with country/parent left null', () => {
    expect(
      transformArea({
        table: 'area',
        values: { id: 1, title: 'Aysen', alias: 'aysen' },
      }),
    ).toMatchObject({ id: 1, name: 'Aysen', alias: 'aysen', country_id: null, parent_area_id: null });
  });
});

describe('transformTour / transformTourItem', () => {
  it('tour maps tours → tour with description', () => {
    expect(
      transformTour({
        table: 'tours',
        values: { id: 1, title: 'Multi-region', description: 'Combo' },
      }),
    ).toMatchObject({ id: 1, title: 'Multi-region', description: 'Combo' });
  });

  it('tour_items maps body → description', () => {
    expect(
      transformTourItem({
        table: 'tour_items',
        values: { id: 1, tour_id: 5, title: 'Day 1', body: 'Travel.' },
      }),
    ).toMatchObject({ id: 1, tour_id: 5, title: 'Day 1', description: 'Travel.' });
  });
});

describe('transformVessel / transformCabintype / transformCabin / transformHotel', () => {
  it('vessel resolves canonical_url via page', () => {
    const out = transformVessel(
      { table: 'vessel', values: { id: 1, title: 'Ventus Australis', alias: 'ventus', page_id: 10 } },
      new Map([[10, 'https://www.swoop-patagonia.com/ventus']]),
    );
    expect(out).toMatchObject({
      id: 1,
      name: 'Ventus Australis',
      canonical_url: 'https://www.swoop-patagonia.com/ventus',
    });
  });

  it('cabin requires vessel_id', () => {
    expect(transformCabin({ table: 'cabin', values: { id: 1 } })).toBeNull();
    expect(
      transformCabin({
        table: 'cabin',
        values: { id: 1, vessel_id: 5, title: 'Suite', cabin_details: 'X' },
      }),
    ).toMatchObject({ id: 1, vessel_id: 5, name: 'Suite', description: 'X' });
  });

  it('cabintype keeps title → name', () => {
    expect(transformCabintype({ table: 'cabintype', values: { id: 1, title: 'Standard' } })).toMatchObject({
      id: 1,
      name: 'Standard',
    });
  });

  it('hotel resolves canonical_url via page', () => {
    const out = transformHotel(
      { table: 'hotel', values: { id: 1, title: 'Tierra', alias: 'tierra', page_id: 7 } },
      emptyLookups(),
      new Map([[7, 'https://www.swoop-patagonia.com/tierra']]),
    );
    expect(out).toMatchObject({
      id: 1,
      name: 'Tierra',
      canonical_url: 'https://www.swoop-patagonia.com/tierra',
    });
  });
});

describe('transformCustomerReviewTrip', () => {
  it('keeps junction with both ids', () => {
    expect(
      transformCustomerReviewTrip({
        table: 'customerreview_trip',
        values: { id: 1, customerreview_id: 10, trip_id: 5, position: 0 },
      }),
    ).toMatchObject({ id: 1, customerreview_id: 10, trip_id: 5, position: 0 });
  });

  it('drops if either FK missing', () => {
    expect(
      transformCustomerReviewTrip({
        table: 'customerreview_trip',
        values: { id: 1, customerreview_id: null, trip_id: 5 },
      }),
    ).toBeNull();
  });
});
