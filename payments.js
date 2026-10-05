// Backend payment logic only. The frontend never sees card data or API keys.
const crypto = require('crypto');
const PLANS = {
  credit: { label: 'Calculation Credit', amount: 300 },
  subscription: { label: 'Monthly Pro', amount: 99 },
};
const providers = {
  // Demo provider: always succeeds, charges nothing.
  mock: async ({ plan }) => ({ id: 'mock_' + crypto.randomBytes(6).toString('hex'), status: 'succeeded', amount: PLANS[plan].amount }),
  // Connect Stripe here (see README): create a Checkout Session with process.env.STRIPE_SECRET_KEY,
  // then grant the credit/subscription from a verified webhook.
  stripe: async () => { throw new Error('Stripe provider not implemented yet - see README'); },
};
async function charge(plan) {
  if (!PLANS[plan]) throw new Error('Unknown plan');
  const p = providers[process.env.PAYMENT_PROVIDER || 'mock'];
  if (!p) throw new Error('Unknown payment provider');
  return p({ plan });
}
module.exports = { PLANS, charge };
