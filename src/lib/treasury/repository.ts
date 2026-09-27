import type {
  ActivityEntry,
  AgentDecision,
  IntegrationStatus,
  Obligation,
  PortfolioSnapshot,
  StrategyPosition,
} from "./models";
import { demoTreasury } from "./fixtures";

export interface TreasuryRepository {
  getPortfolio(): Promise<PortfolioSnapshot>;
  listObligations(): Promise<Obligation[]>;
  listStrategies(): Promise<StrategyPosition[]>;
  listActivities(): Promise<ActivityEntry[]>;
  listAgentDecisions(): Promise<AgentDecision[]>;
  listIntegrations(): Promise<IntegrationStatus[]>;
}

class DemoTreasuryRepository implements TreasuryRepository {
  async getPortfolio() { return demoTreasury.portfolio; }
  async listObligations() { return demoTreasury.obligations; }
  async listStrategies() { return demoTreasury.strategies; }
  async listActivities() { return demoTreasury.activities; }
  async listAgentDecisions() { return demoTreasury.decisions; }
  async listIntegrations() { return demoTreasury.integrations; }
}

export function getTreasuryRepository(): TreasuryRepository {
  return new DemoTreasuryRepository();
}
