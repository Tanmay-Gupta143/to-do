declare module "success-motivational-quotes" {
  type Quote = { id: string; category: string; body: string; by: string };
  const quotes: { getAllQuotes: () => Quote[] };
  export default quotes;
}
