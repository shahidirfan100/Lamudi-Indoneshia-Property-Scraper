import prettier from 'eslint-config-prettier';

import apify from '@apify/eslint-config/js.js';

// eslint-disable-next-line import-x/no-default-export
export default [
    {
        ignores: ['**/dist'],
        rules: {
            'import-x/no-default-export': 'off',
        },
    },
    ...apify,
    prettier,
];
