# The isolated restore network: where restore tests put the restored Aurora clusters.
#
# A test restore is a full copy of production data. It must not be reachable from anywhere and
# must not reach anything, so this VPC is a dead end by construction:
#   - no internet gateway, no NAT, no Transit Gateway attachment, no peering, no VPN: the only
#     route is the implicit "local" one (the route table below pins routes to none, so a route
#     added by hand is drift that the next plan removes)
#   - private subnets in every AZ of the region (an Aurora DB subnet group needs >= 2 AZs; all
#     three so a restore test still runs with an AZ down)
#   - one security group that only admits traffic from itself (the validation runs inside the
#     VPC); the VPC's default security group is emptied, so a restore that ignored the override
#     would still have no ingress at all
#
# Deliberately NOT here:
#   - Interface endpoints. AWS Backup and RDS run restores and deletes on their control plane,
#     outside the VPC, and the PoC validates restores by job status only (nothing runs inside
#     the VPC). A validation Lambda in the VPC that connects to the restored database would
#     need endpoints for backup (PutRestoreValidationResult), secretsmanager and logs: add them
#     with that Lambda, not before.
#   - VPC flow logs. The account baseline configures none for any VPC (flow logging belongs to
#     the network standard, architecture 1.5); with no route out there is nothing to egress.
#     Add them here when the network stack sets the org-wide flow-log standard.

resource "aws_vpc" "restore" {
  cidr_block           = var.restore_vpc_cidr
  enable_dns_support   = true # RDS endpoints resolve to private IPs via the VPC resolver
  enable_dns_hostnames = true

  tags = merge(local.tags, { Name = "northstar-restore-test" })
}

resource "aws_subnet" "restore" {
  for_each = { for i, az in var.restore_azs : az => i }

  vpc_id                  = aws_vpc.restore.id
  availability_zone       = each.key
  cidr_block              = cidrsubnet(var.restore_vpc_cidr, 2, each.value) # /24 -> four /26, one per AZ
  map_public_ip_on_launch = false

  tags = merge(local.tags, { Name = "northstar-restore-test-${each.key}", tier = "isolated" })
}

# Explicit, empty route table: only the implicit local route. `route = []` makes Terraform own
# the route set, so any route added out of band (to a gateway, NAT or TGW) shows up as drift.
resource "aws_route_table" "restore" {
  vpc_id = aws_vpc.restore.id
  route  = []

  tags = merge(local.tags, { Name = "northstar-restore-test-isolated" })
}

resource "aws_route_table_association" "restore" {
  for_each = aws_subnet.restore

  subnet_id      = each.value.id
  route_table_id = aws_route_table.restore.id
}

# No rules at all on the default security group (it allows all traffic between members by
# default). Anything launched without an explicit group gets no network access.
resource "aws_default_security_group" "restore" {
  vpc_id = aws_vpc.restore.id

  tags = merge(local.tags, { Name = "northstar-restore-test-default-closed" })
}

resource "aws_security_group" "restore" {
  name        = "northstar-restore-test"
  description = "Restored Aurora clusters: reachable only from members of this group, inside the isolated VPC"
  vpc_id      = aws_vpc.restore.id

  tags = merge(local.tags, { Name = "northstar-restore-test" })
}

# Aurora PostgreSQL and Aurora MySQL ports, from this group only: never a CIDR, never 0.0.0.0/0.
resource "aws_vpc_security_group_ingress_rule" "restore_from_self" {
  for_each = toset(["5432", "3306"])

  security_group_id            = aws_security_group.restore.id
  referenced_security_group_id = aws_security_group.restore.id
  ip_protocol                  = "tcp"
  from_port                    = tonumber(each.value)
  to_port                      = tonumber(each.value)
  description                  = "Restore validation inside the VPC"
}

resource "aws_vpc_security_group_egress_rule" "restore_to_self" {
  for_each = toset(["5432", "3306"])

  security_group_id            = aws_security_group.restore.id
  referenced_security_group_id = aws_security_group.restore.id
  ip_protocol                  = "tcp"
  from_port                    = tonumber(each.value)
  to_port                      = tonumber(each.value)
  description                  = "Restore validation inside the VPC"
}

resource "aws_db_subnet_group" "restore" {
  name        = var.restore_db_subnet_group_name
  description = "Isolated restore VPC for AWS Backup restore tests (no route out)"
  subnet_ids  = [for s in aws_subnet.restore : s.id]

  tags = local.tags
}
