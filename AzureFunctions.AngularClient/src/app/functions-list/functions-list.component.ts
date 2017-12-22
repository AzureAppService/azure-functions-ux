import { FunctionInfo } from 'app/shared/models/function-info';
import { CreateCard } from 'app/function/function-new/function-new.component';
import { ArmSiteDescriptor } from 'app/shared/resourceDescriptors';
import { FunctionsService, FunctionAppContext } from './../shared/services/functions-service';
import { DashboardType } from 'app/tree-view/models/dashboard-type';
import { ErrorIds } from './../shared/models/error-ids';
import { BroadcastEvent } from 'app/shared/models/broadcast-event';
import { BroadcastService } from './../shared/services/broadcast.service';
import { AppNode } from './../tree-view/app-node';
import { Component, OnDestroy, Injector } from '@angular/core';
import { Subject } from 'rxjs/Subject';
import { FunctionNode } from './../tree-view/function-node';
import { FunctionsNode } from './../tree-view/functions-node';
import { TreeViewInfo } from './../tree-view/models/tree-view-info';
import { FunctionApp } from '../shared/function-app';
import { GlobalStateService } from '../shared/services/global-state.service';
import { TranslateService } from '@ngx-translate/core';
import { PortalResources } from '../shared/models/portal-resources';
import { PortalService } from '../shared/services/portal.service';
import { ErrorType, ErrorEvent } from 'app/shared/models/error-event';
import { Observable } from 'rxjs/Observable';

@Component({
    selector: 'functions-list',
    templateUrl: './functions-list.component.html',
    styleUrls: ['./functions-list.component.scss']
})
export class FunctionsListComponent implements OnDestroy {
    public functions: FunctionNode[] = [];
    public isLoading: boolean;
    public functionApp: FunctionApp;
    public appNode: AppNode;
    public runtimeVersion: string;
    public context: FunctionAppContext;
    public sidePanelOpened = false;
    public createCards: CreateCard[] = [];
    public createFunctionCard: CreateCard = null;
    public createFunctionLanguage: string = null;
    public functionsInfo: FunctionInfo[];

    private _functionsNode: FunctionsNode;
    private _ngUnsubscribe = new Subject<void>();

    constructor(private _globalStateService: GlobalStateService,
        private _portalService: PortalService,
        private _translateService: TranslateService,
        private _broadcastService: BroadcastService,
        private _functionsService: FunctionsService,
        private _injector: Injector) {

            console.log("FUNCTIONSLISTCOMPONENT!");

        this._broadcastService.getEvents<TreeViewInfo<void>>(BroadcastEvent.TreeNavigation)
            .filter(viewInfo => viewInfo.dashboardType === DashboardType.FunctionsDashboard)
            .takeUntil(this._ngUnsubscribe)
            .distinctUntilChanged()
            .switchMap(viewInfo => {
                this.isLoading = true;
                this._functionsNode = (<FunctionsNode>viewInfo.node);
                this.appNode = (<AppNode>viewInfo.node.parent);
                const descriptor = ArmSiteDescriptor.getSiteDescriptor(viewInfo.resourceId);
                return this._functionsService.getAppContext(descriptor.getTrimmedResourceId());
            })
            .switchMap(context => {
                this.context = context;

                if (this.functionApp) {
                    this.functionApp.dispose();
                }

                this.functionApp = new FunctionApp(context.site, this._injector);
                return Observable.zip(
                    this._functionsNode.loadChildren(),
                    this.functionApp.getRuntimeGeneration(),
                    this._buildCreateCardTemplate(this.functionApp),
                    this.functionApp.getFunctions(),
                    this._functionsService.getFunctions(context),
                    (a, b, c, fcs, fs) => ({runtimeVersion : b, cards: c, fcs: fcs, fs: fs }));
            })
            .subscribe((r) => {
                this.runtimeVersion = r.runtimeVersion;
                this.isLoading = false;
                this.functions = (<FunctionNode[]>this._functionsNode.children);
                this.functionsInfo = r.fcs;
                if (this._portalService.isEmbeddedFunctions) {
                    this.functionsInfo = r.fs;
                }
            });
    }

    private _buildCreateCardTemplate(functionApp: FunctionApp) {
        return functionApp.getTemplates()
            .switchMap(templates => {
                return Observable.of(templates);
            })
            .do(templates => {

                templates.forEach((template) => {

                        const templateIndex = this.createCards.findIndex(finalTemplate => {
                            return finalTemplate.name === template.metadata.name;
                        });

                        // if the card doesn't exist, create it based off the template, else add information to the preexisting card
                        if (templateIndex === -1) {
                            this.createCards.push({
                                name: `${template.metadata.name}`,
                                value: template.id,
                                description: template.metadata.description,
                                enabledInTryMode: template.metadata.enabledInTryMode,
                                AADPermissions: template.metadata.AADPermissions,
                                languages: [`${template.metadata.language}`],
                                categories: template.metadata.category,
                                ids: [`${template.id}`],
                                icon: 'image/other.svg',
                                color: '#000000',
                                barcolor: '#D9D9D9',
                                focusable: false
                            });
                        } else {
                            this.createCards[templateIndex].languages.push(`${template.metadata.language}`);
                            this.createCards[templateIndex].categories = this.createCards[templateIndex].categories.concat(template.metadata.category);
                            this.createCards[templateIndex].ids.push(`${template.id}`);
                        }
                });

                // unique categories
                this.createCards.forEach((template, index) => {
                    const categoriesDict: {[key: string]: string; } = {};
                    template.categories.forEach(category => {
                        categoriesDict[category] = category;
                    });
                    this.createCards[index].categories = [];
                    for (const category in categoriesDict) {
                        if (categoriesDict.hasOwnProperty(category)) {
                            this.createCards[index].categories.push(category);
                        }
                    }
                });

                this.createFunctionCard = this.createCards[0];
        });
    }

    ngOnDestroy(): void {
        this._ngUnsubscribe.next();
        if (this.functionApp) {
            this.functionApp.dispose();
        }
    }

    clickRow(item: FunctionNode) {
        item.select();
    }

    enableChange(item: FunctionNode, enabled: boolean) {
        item.functionInfo.config.disabled = !enabled;
        this._globalStateService.setBusyState();
        item.functionInfo.config.disabled
            ? this._portalService.logAction('function-list', 'disable')
            : this._portalService.logAction('function-list', 'enable');

        const observable = (this.runtimeVersion === 'V2') ? this.functionApp.updateDisabledAppSettings([item.functionInfo]):
            this.functionApp.updateFunction(item.functionInfo);

        return observable.do(null, e => {
            item.functionInfo.config.disabled = !item.functionInfo.config.disabled;
            const state = item.functionInfo.config.disabled ? this._translateService.instant(PortalResources.enable) : this._translateService.instant(PortalResources.disable);
            this._broadcastService.broadcast<ErrorEvent>(BroadcastEvent.Error, {
                message: this._translateService.instant(PortalResources.failedToSwitchFunctionState, { state: state, functionName: item.functionInfo.name }),
                errorId: ErrorIds.failedToSwitchEnabledFunction,
                errorType: ErrorType.UserError,
                resourceId: this.functionApp.site.id
            });
            this._globalStateService.clearBusyState();
            console.error(e);
        })
        .subscribe(() => {
            this._broadcastService.broadcast<string>(BroadcastEvent.ClearError, ErrorIds.failedToSwitchEnabledFunction);
            this._globalStateService.clearBusyState();
        });
    }

    clickDelete(item: FunctionNode) {
        const functionInfo = item.functionInfo;
        const result = confirm(this._translateService.instant(PortalResources.functionManage_areYouSure, { name: functionInfo.name }));
        if (result) {
            this._globalStateService.setBusyState();
            this._portalService.logAction('function-list', 'delete');
            this.functionApp.deleteFunction(functionInfo)
                .do(null, e => {
                    this._globalStateService.clearBusyState();
                    console.error(e);
                })
                .subscribe(() => {
                    const indexToDelete = this.functions.indexOf(item);
                    if (indexToDelete > -1) {
                        this.functions.splice(indexToDelete, 1);
                    }

                    const resourceId = `${this._functionsNode.resourceId}/${item.functionInfo.name}`;
                    this._functionsNode.removeChild(resourceId, false);

                    const defaultHostName = this.functionApp.site.properties.defaultHostName;
                    const scmHostName = this.functionApp.site.properties.hostNameSslStates.find(s => s.hostType === 1).name;

                    item.sideNav.cacheService.clearCachePrefix(`https://${defaultHostName}`);
                    item.sideNav.cacheService.clearCachePrefix(`https://${scmHostName}`);

                    this._globalStateService.clearBusyState();
                });
        }
    }

    searchChanged(value: string) {
        this.functions = (<FunctionNode[]>this._functionsNode.children).filter(c => {
            return c.functionInfo.name.toLowerCase().indexOf(value.toLowerCase()) > -1;
        });
    }

    searchCleared() {
        this.functions = (<FunctionNode[]>this._functionsNode.children);
    }

    onNewFunctionClick() {
        if (this._portalService.isEmbeddedFunctions) {
            this.sidePanelOpened = true;
        } else {
            this._functionsNode.openCreateDashboard(DashboardType.CreateFunctionDashboard);
        }
    }

    closeSidePanel() {
        this.sidePanelOpened = false;
    }
}
