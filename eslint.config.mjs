import nextConfig from 'eslint-config-next'

export default [
  ...nextConfig,
  { ignores: ['drizzle/**'] },
  {
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
]
