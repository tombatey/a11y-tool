module.exports = {
  // No extends — only rules that indicate genuine errors, not style preferences.
  // stylelint-config-standard generates hundreds of formatting warnings per file;
  // this ruleset focuses on things that are actually broken.
  rules: {
    // Invalid values
    'color-no-invalid-hex':                          true,
    'unit-no-unknown':                               true,
    'property-no-unknown':                           [true, { ignoreProperties: [/^-/] }],
    'function-no-unknown':                           [true, { ignoreFunctions: [/^-/] }],

    // Structural errors
    'no-duplicate-at-import-rules':                  true,
    'no-duplicate-selectors':                        true,
    'no-invalid-double-slash-comments':              true,
    'no-invalid-position-at-import-rule':            true,
    'declaration-block-no-duplicate-properties':     [true, { ignore: ['consecutive-duplicates-with-different-values'] }],
    'declaration-block-no-shorthand-property-overrides': true,

    // Unknown selectors / pseudo-classes
    'selector-pseudo-class-no-unknown':              [true, { ignorePseudoClasses: ['global', 'local', 'root', 'where', 'is', 'has'] }],
    'selector-pseudo-element-no-unknown':            [true, { ignorePseudoElements: ['webkit-scrollbar', 'moz-placeholder'] }],
    'selector-type-no-unknown':                      [true, { ignore: ['custom-elements'] }],

    // Font issues
    'font-family-no-duplicate-names':                true,
    'font-family-no-missing-generic-family-keyword': [true, { ignoreFontFamilies: ['monospace'] }],

    // Keyframe issues
    'keyframe-declaration-no-important':             true,
    'no-unknown-animations':                         true,
  },
};
