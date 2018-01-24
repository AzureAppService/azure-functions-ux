import { TranslateService } from '@ngx-translate/core';
import { PortalResources } from '../../../../../shared/models/portal-resources';
import { TableItem } from '../../../../../controls/tbl/tbl.component';
import { CacheService } from '../../../../../shared/services/cache.service';
import { BusyStateScopeManager } from '../../../../../busy-state/busy-state-scope-manager';
import { BusyStateComponent } from '../../../../../busy-state/busy-state.component';
import { SimpleChanges } from '@angular/core/src/metadata/lifecycle_hooks';
import { Subject } from 'rxjs/Rx';
import { Deployment } from '../../../Models/deploymentData';
import { ArmArrayResult, ArmObj } from '../../../../../shared/models/arm/arm-obj';
import { Component, EventEmitter, Input, OnChanges, Output, ViewChild } from '@angular/core';
import { Subscription as RxSubscription } from 'rxjs/Subscription';
import * as moment from 'moment';
import { BroadcastService } from 'app/shared/services/broadcast.service';
import { LogService } from 'app/shared/services/log.service';
import { LogCategories } from 'app/shared/models/constants';

class DeploymentDetailTableItem implements TableItem {
    public type: 'row' | 'group';
    public time: string;
    public activity: string;
    public log: string;
    public id: string;
}

interface DeploymentLogItem {
    log_time: string;
    id: string;
    message: string;
    type: number;
    details_url: string;
}
@Component({
    selector: 'app-deployment-detail',
    templateUrl: './deployment-detail.component.html',
    styleUrls: ['./deployment-detail.component.scss']
})
export class DeploymentDetailComponent implements OnChanges {
    @Input() deploymentObject: ArmObj<Deployment>;
    @ViewChild(BusyStateComponent) busyState: BusyStateComponent;
    @Output() closePanel = new EventEmitter();
    public viewInfoStream: Subject<ArmObj<Deployment>>;

    _viewInfoSubscription: RxSubscription;
    _busyStateScopeManager: BusyStateScopeManager;

    private _tableItems: DeploymentDetailTableItem[];

    public logsToShow;
    constructor(
        private _cacheService: CacheService,
        private _logService: LogService,
        private _translateService: TranslateService,
        broadcastService: BroadcastService
    ) {
        this._tableItems = [];
        this.viewInfoStream = new Subject<ArmObj<Deployment>>();
        this._viewInfoSubscription = this.viewInfoStream
            .distinctUntilChanged()
            .switchMap(deploymentObject => {
                this.busyState.setBusyState();
                this.logsToShow = null;
                const deploymentId = deploymentObject.id;
                return this._cacheService.getArm(`${deploymentId}/log`);
            })
            .subscribe(
                r => {
                    this.busyState.clearBusyState();
                    const logs: ArmArrayResult<DeploymentLogItem> = r.json();
                    this._tableItems = [];
                    logs.value.forEach(val => {
                        const date: Date = new Date(val.properties.log_time);
                        const t = moment(date);
                        this._tableItems.push({
                            type: 'row',
                            time: t.format('h:mm:ss A'),
                            activity: val.properties.message,
                            log: val.properties.details_url,
                            id: val.id
                        });
                    });
                },
                err => {
                    this.deploymentObject = null;
                    this._logService.error(LogCategories.cicd, '/deployment-kudu-details', err);
                    this.busyState.clearBusyState();
                }
            );
    }

    get TableItems() {
        return this._tableItems || [];
    }

    redeploy() {
        this._cacheService.putArm(this.deploymentObject.id).subscribe(
            r => {},
            err => {
                this._logService.error(LogCategories.cicd, '/deployment-kudu-redeploy', err);
            }
        );
    }

    close() {
        this.closePanel.emit();
    }

    showLogs(item: DeploymentDetailTableItem) {
        this.logsToShow = this._translateService.instant(PortalResources.resourceSelect);
        this._cacheService.getArm(item.id).subscribe(r => {
            const obs: ArmObj<any>[] = r.json().value;
            const message = obs.map(x => x.properties.message as string).join('\n');
            this.logsToShow = message;
        });
    }

    public ngOnChanges(changes: SimpleChanges): void {
        if (changes['deploymentObject']) {
            if (this.deploymentObject) {
                this.viewInfoStream.next(this.deploymentObject);
            }
        }
    }
}
