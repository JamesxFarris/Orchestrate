import { readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import {
  AgentRuntime,
  TeamConfig,
  type RoleConfig,
  type RoleKind,
  type SquadConfig,
  type TeamConfigInput,
} from '@orchestrate/shared';

export class TeamConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid team config:\n- ${problems.join('\n- ')}`);
  }
}

/** Validated, queryable view of a team.yaml. */
export class Org {
  readonly roles: RoleConfig[];

  /** Directory relative paths in the team file resolve against. */
  baseDir = process.cwd();

  private constructor(readonly config: TeamConfig) {
    this.roles = config.roles.filter((r) => r.enabled);
  }

  static fromConfig(input: TeamConfigInput | unknown): Org {
    const parsed = TeamConfig.safeParse(input);
    if (!parsed.success) {
      throw new TeamConfigError(parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
    }
    const org = new Org(parsed.data);
    const problems = org.validate();
    if (problems.length) throw new TeamConfigError(problems);
    return org;
  }

  static fromYaml(text: string): Org {
    return Org.fromConfig(YAML.parse(text));
  }

  static load(file: string): Org {
    const org = Org.fromYaml(readFileSync(file, 'utf8'));
    org.baseDir = path.dirname(path.resolve(file));
    return org;
  }

  /** Absolute read-only reference directories outside the repo. */
  externalReferenceDirs(): string[] {
    return this.config.project.externalReferenceDirs.map((d) => path.resolve(this.baseDir, d));
  }

  get project() {
    return this.config.project;
  }
  get policy() {
    return this.config.policy;
  }
  get gates() {
    return this.config.gates;
  }
  get squads(): SquadConfig[] {
    return this.config.squads;
  }

  role(id: string): RoleConfig {
    const r = this.roles.find((x) => x.id === id);
    if (!r) throw new Error(`Unknown or disabled role "${id}"`);
    return r;
  }

  squad(id: string): SquadConfig {
    const s = this.config.squads.find((x) => x.id === id);
    if (!s) throw new Error(`Unknown squad "${id}"`);
    return s;
  }

  hasSquad(id: string): boolean {
    return this.config.squads.some((x) => x.id === id);
  }

  master(): RoleConfig {
    return this.roles.find((r) => r.kind === 'master')!;
  }

  /** First enabled role of `kind` in `squad`, if any. */
  squadRole(squadId: string, kind: RoleKind): RoleConfig | undefined {
    return this.roles.find((r) => r.squad === squadId && r.kind === kind);
  }

  /** First enabled HQ (squad-less) role of `kind`. */
  hqRole(kind: RoleKind): RoleConfig | undefined {
    return this.roles.find((r) => !r.squad && r.kind === kind);
  }

  /** Who implements a task of this kind in this squad. */
  implementer(squadId: string, kind: 'code' | 'research'): RoleConfig | undefined {
    return kind === 'research'
      ? (this.squadRole(squadId, 'analyst') ?? this.squadRole(squadId, 'dev'))
      : this.squadRole(squadId, 'dev');
  }

  /** Who reviews diffs and rules on escalations for this squad. */
  lead(squadId: string): RoleConfig {
    return this.squadRole(squadId, 'lead') ?? this.hqRole('architect') ?? this.master();
  }

  circle(): RoleConfig[] {
    return this.config.techCircle.map((id) => this.roles.find((r) => r.id === id)).filter((r): r is RoleConfig => !!r);
  }

  runtimeFor(role: RoleConfig): AgentRuntime {
    return AgentRuntime.parse({ ...this.config.defaults, ...role.runtime });
  }

  private validate(): string[] {
    const problems: string[] = [];
    const ids = new Set<string>();
    for (const r of this.config.roles) {
      if (ids.has(r.id)) problems.push(`duplicate role id "${r.id}"`);
      ids.add(r.id);
      if (r.squad && !this.hasSquad(r.squad)) problems.push(`role "${r.id}" references unknown squad "${r.squad}"`);
      if (r.reportsTo && !this.config.roles.some((x) => x.id === r.reportsTo)) {
        problems.push(`role "${r.id}" reports to unknown role "${r.reportsTo}"`);
      }
    }
    const squadIds = new Set<string>();
    for (const s of this.config.squads) {
      if (squadIds.has(s.id)) problems.push(`duplicate squad id "${s.id}"`);
      squadIds.add(s.id);
      if (!this.implementer(s.id, 'code') && !this.implementer(s.id, 'research')) {
        problems.push(`squad "${s.id}" has no enabled dev or analyst`);
      }
    }
    const masters = this.roles.filter((r) => r.kind === 'master');
    if (masters.length !== 1) problems.push(`exactly one enabled master role is required (found ${masters.length})`);
    for (const id of this.config.techCircle) {
      if (!ids.has(id)) problems.push(`techCircle member "${id}" is not a role`);
    }
    return problems;
  }
}
