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
  transformCustomerTip,
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
    areaIdByTagId: new Map(),
    contentblockById: new Map(),
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

  it('derives region_id from a single area-typed tag', () => {
    const lookups = emptyLookups();
    // Trip 700 has tag-ids [62] (= area-typed ntag with alias 'torres-del-paine').
    // areaIdByTagId resolves 62 → area.id 60.
    lookups.ntagsByEntity.set('trip', new Map([[700, [62]]]));
    lookups.areaIdByTagId.set(62, 60);

    const result = transformTrip(
      { table: 'trip', values: { id: 700, title: 'W Trek', page_id: null } },
      lookups,
      new Map(),
    );
    expect(result.row?.region_id).toBe(60);
  });

  it('picks the lowest area.id for multi-area trips', () => {
    const lookups = emptyLookups();
    // Trip 422 ("south-america-wild-patagonia") has 7 area tags spanning
    // Antarctica/Aysén/TdP/FTE & Chalten/etc. — lowest area.id wins per the
    // multi-area rule.
    lookups.ntagsByEntity.set('trip', new Map([[422, [73, 58, 62, 59]]]));
    lookups.areaIdByTagId.set(73, 2); // Antarctica
    lookups.areaIdByTagId.set(58, 4); // Aysén region
    lookups.areaIdByTagId.set(62, 60); // Torres del Paine
    lookups.areaIdByTagId.set(59, 73); // FTE & Chalten

    const result = transformTrip(
      { table: 'trip', values: { id: 422, title: 'Wild Patagonia' } },
      lookups,
      new Map(),
    );
    expect(result.row?.region_id).toBe(2);
  });

  it('leaves region_id null when no area-typed tags resolve', () => {
    const lookups = emptyLookups();
    // Trip 371 ("adventure-travel-in-patagonia") — meta page, no area tags,
    // or tags whose alias has no corresponding area row (sub-area / campaign
    // tags drop out of areaIdByTagId during loadLookups).
    lookups.ntagsByEntity.set('trip', new Map([[371, [100, 122]]]));
    // areaIdByTagId is empty — those tag ids don't resolve to any area.

    const result = transformTrip(
      { table: 'trip', values: { id: 371, title: 'Adventure travel in Patagonia' } },
      lookups,
      new Map(),
    );
    expect(result.row?.region_id).toBe(null);
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

describe('transformTour', () => {
  // Mirrors what run.ts builds from the kept page rows: page-id → identity.
  function keptPages(): Map<
    number,
    { title: string; alias: string | null; canonical_url: string }
  > {
    return new Map([
      [
        72,
        {
          title: 'Best of Patagonia',
          alias: 'best-chile-argentina',
          canonical_url: 'https://www.swoop-patagonia.com/best-chile-argentina',
        },
      ],
    ]);
  }

  it("takes title/slug/canonical_url from the parent contentblock's page, not the empty tours.title", () => {
    // Source `tours.title` is '' (or NULL) on every real row — tour identity
    // lives on the page the contentblock belongs to (C.focused-shamir-1).
    const lookups = emptyLookups();
    lookups.contentblockById.set(15635, { pageId: 72, typeId: 152 });

    const result = transformTour(
      {
        table: 'tours',
        values: { id: 9, content_block_id: 15635, title: '', description: null, image_id: 10980 },
      },
      lookups,
      keptPages(),
    );
    expect(result.row).toMatchObject({
      id: 9,
      title: 'Best of Patagonia',
      slug: 'best-chile-argentina',
      canonical_url: 'https://www.swoop-patagonia.com/best-chile-argentina',
      page_id: 72,
      image_id: 10980,
    });
  });

  it('drops a tours row whose parent contentblock is not an itinerary block (type_id !== 152)', () => {
    const lookups = emptyLookups();
    // type_id 107 — e.g. an Accommodation-page block that carries a tours row.
    lookups.contentblockById.set(15627, { pageId: 109, typeId: 107 });

    const result = transformTour(
      { table: 'tours', values: { id: 1, content_block_id: 15627, title: '' } },
      lookups,
      keptPages(),
    );
    expect(result.row).toBeNull();
    expect(result.reason).toBe('cb_type_not_itinerary');
  });

  it('drops a tours row whose parent page was filtered upstream (test/profile/deleted/dup)', () => {
    const lookups = emptyLookups();
    // contentblock points at page 509 (paul-test-page-2) — dropped by
    // transformPage, so it is absent from the kept-pages map.
    lookups.contentblockById.set(99, { pageId: 509, typeId: 152 });

    const result = transformTour(
      { table: 'tours', values: { id: 74, content_block_id: 99, title: '' } },
      lookups,
      keptPages(), // does not contain 509
    );
    expect(result.row).toBeNull();
    expect(result.reason).toBe('page_not_loaded');
  });

  it('drops a tours row whose parent contentblock is missing (e.g. soft-deleted)', () => {
    const result = transformTour(
      { table: 'tours', values: { id: 5, content_block_id: 88888, title: '' } },
      emptyLookups(), // contentblockById empty
      keptPages(),
    );
    expect(result.row).toBeNull();
    expect(result.reason).toBe('missing_parent_block');
  });

  it('drops a tours row with no id', () => {
    const result = transformTour(
      { table: 'tours', values: { id: null, content_block_id: 15635, title: '' } },
      emptyLookups(),
      keptPages(),
    );
    expect(result.row).toBeNull();
    expect(result.reason).toBe('missing_id');
  });
});

describe('transformTourItem', () => {
  it('maps body → description', () => {
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

describe('transformCustomerTip', () => {
  it('keeps a valid tip with id + content, mapping base columns', () => {
    const out = transformCustomerTip({
      table: 'customertip',
      values: {
        id: 42,
        content: 'Bring windproof everything.',
        name: 'Sarah',
        created: '2024-03-01 09:00:00',
        deleted: null,
      },
    });
    expect(out).toMatchObject({
      id: 42,
      source_provenance: 'customertip',
      source_id: '42',
      text: 'Bring windproof everything.',
      author_name: 'Sarah',
      source_created_at: '2024-03-01 09:00:00',
    });
  });

  it('trims surrounding whitespace from the tip text', () => {
    const out = transformCustomerTip({
      table: 'customertip',
      values: { id: 1, content: '   pack layers  \n' },
    });
    expect(out?.text).toBe('pack layers');
  });

  it('collapses internal whitespace in the author name', () => {
    const out = transformCustomerTip({
      table: 'customertip',
      values: { id: 1, content: 'x', name: '  Jane   Q.   Doe ' },
    });
    expect(out?.author_name).toBe('Jane Q. Doe');
  });

  it('null/blank author name → author_name null', () => {
    const a = transformCustomerTip({
      table: 'customertip',
      values: { id: 1, content: 'x', name: null },
    });
    const b = transformCustomerTip({
      table: 'customertip',
      values: { id: 2, content: 'x', name: '   ' },
    });
    expect(a?.author_name).toBeNull();
    expect(b?.author_name).toBeNull();
  });

  it('drops a soft-deleted tip (numeric deleted flag)', () => {
    expect(
      transformCustomerTip({
        table: 'customertip',
        values: { id: 1, content: 'x', deleted: 1 },
      }),
    ).toBeNull();
  });

  it('keeps a tip whose deleted flag is 0 (not deleted)', () => {
    expect(
      transformCustomerTip({
        table: 'customertip',
        values: { id: 1, content: 'x', deleted: 0 },
      }),
    ).not.toBeNull();
  });

  it('drops a tip with null or empty-after-trim content', () => {
    expect(
      transformCustomerTip({ table: 'customertip', values: { id: 1, content: null } }),
    ).toBeNull();
    expect(
      transformCustomerTip({ table: 'customertip', values: { id: 2, content: '   ' } }),
    ).toBeNull();
  });

  it('drops a tip with no id', () => {
    expect(
      transformCustomerTip({ table: 'customertip', values: { id: null, content: 'x' } }),
    ).toBeNull();
  });

  it('emits a 64-char sha256 content_hash derived from the trimmed text', () => {
    const out = transformCustomerTip({
      table: 'customertip',
      values: { id: 1, content: '  same text  ' },
    });
    const out2 = transformCustomerTip({
      table: 'customertip',
      values: { id: 2, content: 'same text' },
    });
    expect(out?.content_hash).toMatch(/^[0-9a-f]{64}$/);
    // Hash keys on trimmed text only → identical text, identical hash.
    expect(out?.content_hash).toBe(out2?.content_hash);
  });
});
