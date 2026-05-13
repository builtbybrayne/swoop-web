import { describe, expect, it } from 'vitest';
import { trimCmsDecorativeWhitespace } from '../text-utils.js';

describe('trimCmsDecorativeWhitespace', () => {
  it('returns undefined for null / undefined / empty input', () => {
    expect(trimCmsDecorativeWhitespace(null)).toBeUndefined();
    expect(trimCmsDecorativeWhitespace(undefined)).toBeUndefined();
    expect(trimCmsDecorativeWhitespace('')).toBeUndefined();
    expect(trimCmsDecorativeWhitespace('   ')).toBeUndefined();
  });

  it('strips a trailing <br> inside a closing </p>', () => {
    expect(
      trimCmsDecorativeWhitespace('<p>This tiny desert town is a great place.<br></p>'),
    ).toBe('<p>This tiny desert town is a great place.</p>');
  });

  it('strips trailing &nbsp;<br> inside a closing </p> (the San Pedro pattern)', () => {
    expect(
      trimCmsDecorativeWhitespace(
        '<p>This tiny desert town is a great place.&nbsp;<br></p>',
      ),
    ).toBe('<p>This tiny desert town is a great place.</p>');
  });

  it('strips multiple trailing <br> + &nbsp; combinations', () => {
    expect(
      trimCmsDecorativeWhitespace('<p>Hello.<br><br>&nbsp;<br></p>'),
    ).toBe('<p>Hello.</p>');
  });

  it('strips trailing whitespace and <br> outside the closing </p>', () => {
    expect(
      trimCmsDecorativeWhitespace('<p>Hello.</p><br>\n  &nbsp;'),
    ).toBe('<p>Hello.</p>');
  });

  it('strips a trailing empty paragraph block', () => {
    expect(
      trimCmsDecorativeWhitespace('<p>Hello.</p><p>&nbsp;</p>'),
    ).toBe('<p>Hello.</p>');
  });

  it('preserves interior whitespace and HTML', () => {
    expect(
      trimCmsDecorativeWhitespace(
        '<p>Hello there.<br>How are you?&nbsp;Fine.</p>',
      ),
    ).toBe('<p>Hello there.<br>How are you?&nbsp;Fine.</p>');
  });

  it('strips leading decorative whitespace inside the opening tag', () => {
    expect(
      trimCmsDecorativeWhitespace('<p>&nbsp;<br>Hello.</p>'),
    ).toBe('<p>Hello.</p>');
  });

  it('strips leading whitespace outside any tag', () => {
    expect(
      trimCmsDecorativeWhitespace('\n\n  <p>Hello.</p>'),
    ).toBe('<p>Hello.</p>');
  });

  it('handles plain text without tags', () => {
    expect(
      trimCmsDecorativeWhitespace('  Plain text.  '),
    ).toBe('Plain text.');
  });

  it('returns undefined when the strip empties the content', () => {
    expect(trimCmsDecorativeWhitespace('<p>&nbsp;<br></p>')).toBeUndefined();
    expect(trimCmsDecorativeWhitespace('&nbsp;<br>')).toBeUndefined();
  });
});
