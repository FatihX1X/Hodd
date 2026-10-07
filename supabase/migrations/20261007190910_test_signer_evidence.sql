-- Local-development TEST_SIGNER evidence is stored under its own provider name.
-- Readiness filters by provider, so it never counts for MetaMask, Rabby or Circle.
alter table public.earn_provider_evidence drop constraint earn_provider_evidence_provider_check;
alter table public.earn_provider_evidence add constraint earn_provider_evidence_provider_check
  check (provider in ('CIRCLE_USER_CONTROLLED','CIRCLE_MODULAR','INJECTED_METAMASK','INJECTED_RABBY','TEST_SIGNER'));
